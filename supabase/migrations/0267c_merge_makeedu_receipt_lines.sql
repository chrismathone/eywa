-- 같은 학생·청구월 안에서 동일 수납명의 makeedu 수업 라인을 합친다.
-- 원본은 sourceItems에 보존. 총액/할인/납부/미납/적립을 각각 더하고 다른 반명은 추정 병합하지 않는다.
-- DB 저장 경계에 두어 기존 연동 PC·엑셀 임포터 모두 동일하게 처리한다.
create or replace function public.receipt_line_identity(line jsonb)
returns jsonb language sql immutable parallel safe set search_path = public as $$
  select jsonb_build_array(coalesce(line->>'kind',''), coalesce(line->>'classId',''),
    regexp_replace(btrim(coalesce(line->>'description',line->>'name','')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function public.merge_makeedu_receipt_lines(lines jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare result jsonb := '[]'; positions jsonb := '{}'; line jsonb; previous jsonb;
  merged jsonb; originals jsonb; identity text; field text; idx integer; eligible boolean;
begin
  if jsonb_typeof(lines) is distinct from 'array' then return lines; end if;
  for line in select value from jsonb_array_elements(lines) loop
    eligible := coalesce(line->>'kind','') = '수업'
      and length(btrim(coalesce(line->>'description',''))) > 0
      and jsonb_typeof(line->'paid') = 'number' and jsonb_typeof(line->'unpaid') = 'number';
    foreach field in array array['amount','discount','points','paid','unpaid'] loop
      if (field = 'amount' or line ? field) then
        if jsonb_typeof(line->field) is distinct from 'number' then eligible := false;
        elsif (line->>field)::numeric < 0 or (line->>field)::numeric <> trunc((line->>field)::numeric) then eligible := false;
        end if;
      end if;
    end loop;
    if not coalesce(eligible,false) then result := result || jsonb_build_array(line); continue; end if;
    identity := public.receipt_line_identity(line)::text;
    idx := (positions->>identity)::integer;
    if idx is null then
      positions := positions || jsonb_build_object(identity,jsonb_array_length(result));
      result := result || jsonb_build_array(line);
      continue;
    end if;
    previous := result->idx;
    originals := case when jsonb_typeof(previous->'sourceItems')='array' then previous->'sourceItems' else jsonb_build_array(previous) end
      || case when jsonb_typeof(line->'sourceItems')='array' then line->'sourceItems' else jsonb_build_array(line) end;
    merged := previous || jsonb_build_object('sourceItems',originals);
    foreach field in array array['amount','discount','points','paid','unpaid'] loop
      merged := merged || jsonb_build_object(field,coalesce((previous->>field)::numeric,0)+coalesce((line->>field)::numeric,0));
    end loop;
    -- 서로 다른 결제일/수단을 임의의 대표값으로 덮지 않는다. 각각의 원본에서 조회한다.
    foreach field in array array['method','paidDate','receipt','dueDay','card','discountReason'] loop
      if (previous->field) is distinct from (line->field) then
        merged := merged || jsonb_build_object(field,null);
      end if;
    end loop;
    result := jsonb_set(result,array[idx::text],merged);
  end loop;
  return result;
end;
$$;

create or replace function public.normalize_makeedu_receipt_lines()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.line_items := public.merge_makeedu_receipt_lines(new.line_items);
  return new;
end;
$$;
drop trigger if exists invoices_merge_makeedu_lines on public.invoices;
create trigger invoices_merge_makeedu_lines before insert or update of line_items on public.invoices
for each row execute function public.normalize_makeedu_receipt_lines();

-- 순서 변경/병합으로 배열 인덱스가 바뀌어도, 유효하던 배분의 합계가 새 청구액과 같으면 연결만 옮긴다.
-- 금액이 바뀌거나 이전부터 stale인 그룹은 살리지 않는다(기존 effectiveAllocations가 재확인을 요구).
create or replace function public.relink_session_receipt_allocations()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.line_items is not distinct from new.line_items
    or jsonb_typeof(old.line_items) is distinct from 'array'
    or jsonb_typeof(new.line_items) is distinct from 'array' then return new; end if;
  perform id from public.invoice_session_terms where invoice_id=new.id order by id for update;
  with old_groups as (
    select t.allocation_line_index idx, array_agg(t.id) ids, sum(t.allocation_amount) amount,
      bool_and(coalesce(t.allocation_amount is not null and t.allocation_amount >= 0
        and t.allocation_base_amount is not distinct from t.amount
        and (t.confirmed_sessions is not null or t.amount is null)
        and public.receipt_line_identity(t.allocation_source) = public.receipt_line_identity(old.line_items->t.allocation_line_index)
        and (t.allocation_source->>'amount')::numeric = (old.line_items->t.allocation_line_index->>'amount')::numeric,false)) valid
    from public.invoice_session_terms t where t.invoice_id=new.id and t.allocation_line_index is not null
    group by t.allocation_line_index
  ), targets as (
    select g.*, min(n.ordinality-1)::integer new_idx
    from old_groups g cross join lateral jsonb_array_elements(new.line_items) with ordinality n(line,ordinality)
    where public.receipt_line_identity(n.line) = public.receipt_line_identity(old.line_items->g.idx)
    group by g.idx,g.ids,g.amount,g.valid having count(*)=1
  ), safe_targets as (
    select new_idx from targets
    group by new_idx
    having bool_and(coalesce(valid,false) and amount = (old.line_items->idx->>'amount')::numeric)
      and sum(amount) = (new.line_items->new_idx->>'amount')::numeric
  )
  update public.invoice_session_terms t set allocation_line_index=m.new_idx,
    allocation_source=new.line_items->m.new_idx
  from targets m join safe_targets s on s.new_idx=m.new_idx
  where t.id=any(m.ids) and (t.allocation_line_index is distinct from m.new_idx or t.allocation_source is distinct from new.line_items->m.new_idx);
  return new;
end;
$$;
drop trigger if exists invoices_relink_session_allocations on public.invoices;
create trigger invoices_relink_session_allocations after update of line_items on public.invoices
for each row execute function public.relink_session_receipt_allocations();

revoke all on function public.normalize_makeedu_receipt_lines() from public,anon;
revoke all on function public.relink_session_receipt_allocations() from public,anon;
-- 기존 데이터의 일괄 변환은 이 마이그레이션에서 실행하지 않는다. dry run 후 월 범위를 지정해 별도 적용.
