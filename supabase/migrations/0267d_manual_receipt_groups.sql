-- 반 이동 수납 합산 설정은 원본 동기화와 별도로 보존한다.
alter table public.invoices add column if not exists receipt_merge_groups jsonb not null default '[]';

create or replace function public.receipt_line_identity(line jsonb)
returns jsonb language sql immutable parallel safe set search_path=public as $$
  select jsonb_build_array(coalesce(line->>'kind',''),coalesce(line->>'classId',''),
    regexp_replace(btrim(coalesce(line->>'description',line->>'name','')),'[[:space:]]+',' ','g'),
    coalesce(line->>'receiptGroupId',''));
$$;

create or replace function public.receipt_mergeable(line jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare field text;
begin
  if coalesce(line->>'kind','') not in ('','수업','tuition','수강료') then return false; end if;
  foreach field in array array['amount','discount','points','paid','unpaid'] loop
    if field in ('amount','paid','unpaid') or line ? field then
      if jsonb_typeof(line->field) is distinct from 'number' then return false; end if;
      if (line->>field)::numeric < 0 or (line->>field)::numeric <> trunc((line->>field)::numeric) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- 합산 항목을 원본으로 펼친다. 자동 병합의 원본도 한 단계 펼쳐 둔다.
create or replace function public.receipt_originals(lines jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare output jsonb:='[]'; line jsonb; field text;
begin
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line->'sourceItems')='array' and jsonb_array_length(line->'sourceItems')>0 then
      foreach field in array array['amount','discount','points','paid','unpaid'] loop
        if coalesce((line->>field)::numeric,0) is distinct from
          (select sum(coalesce((s->>field)::numeric,0)) from jsonb_array_elements(line->'sourceItems') s) then
          raise exception '합산 항목과 원본의 금액이 다릅니다. 원본 수납을 다시 확인해 주세요';
        end if;
      end loop;
      output:=output||(line->'sourceItems');
    else output:=output||jsonb_build_array(line); end if;
  end loop;
  return output;
end;
$$;

create or replace function public.apply_receipt_merge_groups(lines jsonb, groups jsonb)
returns jsonb language plpgsql immutable set search_path=public as $$
declare base jsonb; output jsonb:='[]'; line jsonb; rule jsonb; matched jsonb; merged jsonb; field text; seen jsonb:='[]';
begin
  if jsonb_typeof(lines) is distinct from 'array' then return lines; end if;
  -- 설정이 없는 일반 동기화는 기존 처리 경로를 유지한다.
  if groups='[]' and not exists(select 1 from jsonb_array_elements(lines) l where l ? 'receiptGroupId') then
    return public.merge_makeedu_receipt_lines(lines);
  end if;
  base:=public.merge_makeedu_receipt_lines(public.receipt_originals(lines));
  for line in select value from jsonb_array_elements(base) loop
    select g into rule from jsonb_array_elements(groups) g where (g->'members') @> jsonb_build_array(public.receipt_line_identity(line)) limit 1;
    if rule is null then output:=output||jsonb_build_array(line); continue; end if;
    if seen @> jsonb_build_array(rule->>'id') then continue; end if;
    select jsonb_agg(l order by n) into matched from jsonb_array_elements(base) with ordinality a(l,n)
      where (rule->'members') @> jsonb_build_array(public.receipt_line_identity(l));
    -- 환불/잘못된 값으로 바뀐 항목은 합치지 않는다. 금액 변화는 배분의 유효성 검사로 잡힌다.
    if exists(select 1 from jsonb_array_elements(matched) l where not public.receipt_mergeable(l)) then
      output:=output||jsonb_build_array(line); continue;
    end if;
    seen:=seen||jsonb_build_array(rule->>'id');
    merged:=jsonb_build_object('kind','수업','description',rule->>'label','receiptGroupId',rule->>'id',
      'sourceItems',public.receipt_originals(matched));
    foreach field in array array['amount','discount','points','paid','unpaid'] loop
      merged:=merged||jsonb_build_object(field,(select sum(coalesce((l->>field)::numeric,0)) from jsonb_array_elements(matched) l));
    end loop;
    foreach field in array array['method','paidDate','receipt','dueDay','card','discountReason'] loop
      merged:=merged||jsonb_build_object(field,case when (select count(distinct coalesce(l->field,'null')) from jsonb_array_elements(matched) l)=1 then matched->0->field else 'null'::jsonb end);
    end loop;
    output:=output||jsonb_build_array(merged);
  end loop;
  return output;
end;
$$;

create or replace function public.normalize_makeedu_receipt_lines()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  -- upsert의 BEFORE INSERT 이후 UPDATE 단계에서 기존 합산 설정을 사용한다.
  -- 자동 병합도 원본을 보존하므로 UPDATE 단계에서 다시 합산할 수 있다.
  new.line_items:=public.apply_receipt_merge_groups(new.line_items,new.receipt_merge_groups);
  return new;
end;
$$;
drop trigger if exists invoices_merge_makeedu_lines on public.invoices;
create trigger invoices_merge_makeedu_lines before insert or update of line_items,receipt_merge_groups on public.invoices
for each row execute function public.normalize_makeedu_receipt_lines();

-- 합산 원본에 이전 항목이 모두 포함되면 같은 금액의 유효한 배분을 이어 간다.
create or replace function public.receipt_contains_line(candidate jsonb, previous jsonb)
returns boolean language sql immutable set search_path=public as $$
  select public.receipt_line_identity(candidate)=public.receipt_line_identity(previous)
    or (candidate ? 'receiptGroupId' and not exists(
      select 1 from jsonb_array_elements(public.receipt_originals(jsonb_build_array(previous))) p
      where not exists(select 1 from jsonb_array_elements(public.receipt_originals(jsonb_build_array(candidate))) n
        where public.receipt_line_identity(p)=public.receipt_line_identity(n))));
$$;

create or replace function public.relink_session_receipt_allocations()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if old.line_items is not distinct from new.line_items
    or jsonb_typeof(old.line_items) is distinct from 'array' or jsonb_typeof(new.line_items) is distinct from 'array' then return new; end if;
  perform id from public.invoice_session_terms where invoice_id=new.id order by id for update;
  with old_groups as (
    select t.allocation_line_index idx,array_agg(t.id) ids,sum(t.allocation_amount) amount,
      bool_and(coalesce(t.allocation_amount is not null and t.allocation_amount>=0
        and t.allocation_base_amount is not distinct from t.amount and (t.confirmed_sessions is not null or t.amount is null)
        and public.receipt_line_identity(t.allocation_source)=public.receipt_line_identity(old.line_items->t.allocation_line_index)
        and (t.allocation_source->>'amount')::numeric=(old.line_items->t.allocation_line_index->>'amount')::numeric,false)) valid
    from public.invoice_session_terms t where t.invoice_id=new.id and t.allocation_line_index is not null group by t.allocation_line_index
  ), targets as (
    select g.*,min(n.ordinality-1)::integer new_idx from old_groups g
    cross join lateral jsonb_array_elements(new.line_items) with ordinality n(line,ordinality)
    where public.receipt_contains_line(n.line,old.line_items->g.idx)
    group by g.idx,g.ids,g.amount,g.valid having count(*)=1
  ), safe_targets as (
    select new_idx from targets group by new_idx
    having bool_and(coalesce(valid,false) and amount=(old.line_items->idx->>'amount')::numeric)
      and sum(amount)=(new.line_items->new_idx->>'amount')::numeric
  )
  update public.invoice_session_terms t set allocation_line_index=m.new_idx,allocation_source=new.line_items->m.new_idx
  from targets m join safe_targets s on s.new_idx=m.new_idx where t.id=any(m.ids)
    and (t.allocation_line_index is distinct from m.new_idx or t.allocation_source is distinct from new.line_items->m.new_idx);
  return new;
end;
$$;

create or replace function public.edit_receipt_merge_group(p_invoice_id uuid,p_expected_lines jsonb,p_indices integer[] default '{}',p_label text default '',p_remove_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare inv public.invoices%rowtype; updated public.invoices%rowtype; members jsonb; groups jsonb; group_id uuid:=gen_random_uuid(); selected jsonb; field text;
begin
  if not coalesce(public.auth_billing_can_write(),false) then raise exception '수납 관리 권한이 없습니다'; end if;
  select * into inv from invoices where id=p_invoice_id and tenant_id=auth_tenant_id() and status<>'void' for update;
  if not found then raise exception '유효한 청구서를 찾을 수 없습니다'; end if;
  if inv.line_items is distinct from p_expected_lines then raise exception '수납 내역이 변경되었습니다. 다시 열어 확인해 주세요'; end if;
  if p_remove_id is not null then
    if not exists(select 1 from jsonb_array_elements(inv.receipt_merge_groups) g where g->>'id'=p_remove_id::text) then raise exception '합산 항목을 찾을 수 없습니다'; end if;
    select coalesce(jsonb_agg(g),'[]') into groups from jsonb_array_elements(inv.receipt_merge_groups) g where g->>'id'<>p_remove_id::text;
  else
    if coalesce(cardinality(p_indices),0)<2 or cardinality(p_indices)>50 or cardinality(p_indices)<>(select count(distinct x) from unnest(p_indices) x)
      or exists(select 1 from unnest(p_indices) x where x is null or x<0 or x>=jsonb_array_length(inv.line_items)) then raise exception '합산할 수납 항목을 2개 이상 선택해 주세요'; end if;
    if length(btrim(coalesce(p_label,'')))=0 or length(p_label)>200 then raise exception '합산 수납명을 200자 이내로 입력해 주세요'; end if;
    select jsonb_agg(l order by n) into selected from jsonb_array_elements(inv.line_items) with ordinality a(l,n) where n-1=any(p_indices);
    if exists(select 1 from jsonb_array_elements(selected) l where not public.receipt_mergeable(l)) then raise exception '납부·미납 내역이 있는 0원 이상 수업 항목만 합산할 수 있습니다'; end if;
    select jsonb_agg(distinct public.receipt_line_identity(l)) into members from jsonb_array_elements(public.receipt_originals(selected)) l;
    if exists(select 1 from jsonb_array_elements(inv.line_items) with ordinality a(l,n) where not (n-1=any(p_indices))
      and exists(select 1 from jsonb_array_elements(public.receipt_originals(jsonb_build_array(l))) s where members @> jsonb_build_array(public.receipt_line_identity(s)))) then
      raise exception '같은 수납명의 분할 항목을 모두 선택해 주세요';
    end if;
    select coalesce(jsonb_agg(g),'[]') into groups from jsonb_array_elements(inv.receipt_merge_groups) g
      where not exists(select 1 from jsonb_array_elements(selected) l where l->>'receiptGroupId'=g->>'id');
    groups:=groups||jsonb_build_array(jsonb_build_object('id',group_id,'label',btrim(p_label),'members',members));
  end if;
  update invoices set receipt_merge_groups=groups,line_items=line_items where id=inv.id returning * into updated;
  foreach field in array array['amount','discount','points','paid','unpaid'] loop
    if (select sum(coalesce((l->>field)::numeric,0)) from jsonb_array_elements(inv.line_items) l)
      is distinct from (select sum(coalesce((l->>field)::numeric,0)) from jsonb_array_elements(updated.line_items) l) then raise exception '수납 총액 검산에 실패했습니다'; end if;
  end loop;
  insert into public.audit_logs(tenant_id,actor_id,actor_name,action,target_type,metadata)
    values(inv.tenant_id,auth.uid(),(select display_name from public.users where id=auth.uid()),'invoice_receipt_merge','invoice',
      jsonb_build_object('invoiceId',inv.id,'removedGroupId',p_remove_id,'beforeLines',inv.line_items,'afterLines',updated.line_items,'beforeGroups',inv.receipt_merge_groups,'afterGroups',groups));
  return updated.line_items;
end;
$$;
revoke all on function public.edit_receipt_merge_group(uuid,jsonb,integer[],text,uuid) from public,anon;
grant execute on function public.edit_receipt_merge_group(uuid,jsonb,integer[],text,uuid) to authenticated;
