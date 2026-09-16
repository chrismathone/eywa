-- MakeEdu 원 청구/할인/납부 합계는 보존한다. 환불은 상세 기록이며 전체환불의 급여 기준은 0원이다.
create or replace function public.receipt_salary_amount(line jsonb)
returns numeric language plpgsql immutable set search_path=public as $$
declare part jsonb; value numeric; total numeric:=0;
begin
  if jsonb_typeof(line->'sourceItems')='array' and jsonb_array_length(line->'sourceItems')>0 then
    for part in select x from jsonb_array_elements(line->'sourceItems') x loop
      value:=public.receipt_salary_amount(part);
      if value is null then return null; end if;
      total:=total+value;
    end loop;
    return total;
  end if;
  if jsonb_typeof(line->'refunds')='array' then
    if exists(select 1 from jsonb_array_elements(line->'refunds') r where r->>'status'='active' and r->>'type'='full'
      and jsonb_typeof(r->'amount')='number' and (r->>'amount')::numeric>=0 and (r->>'amount')::numeric=trunc((r->>'amount')::numeric)) then return 0; end if;
    if exists(select 1 from jsonb_array_elements(line->'refunds') r where coalesce(r->>'status','')<>'cancelled') then return null; end if;
  end if;
  return coalesce((line->>'amount')::numeric,0);
end;
$$;

create or replace function public.receipt_is_tuition(line jsonb)
returns boolean language plpgsql immutable set search_path=public as $$
declare part jsonb; label text:=btrim(coalesce(line->>'description',line->>'name',''));
begin
  if coalesce(line->>'kind','') not in ('','수업','tuition','수강료') or public.receipt_salary_amount(line) is null then return false; end if;
  if label ~* '^(\[강아\]|(\[인재원\][[:space:]]*)?강의하는[[:space:]]*아이들)'
    or label ~* '^\[eie\][[:space:]]*(phonics[[:space:]]*&[[:space:]]*rookies|rookies[[:space:]]*&[[:space:]]*leaders)([[:space:]]|$)' then return false; end if;
  if jsonb_typeof(line->'sourceItems')='array' then
    for part in select x from jsonb_array_elements(line->'sourceItems') x loop
      if not public.receipt_is_tuition(part) then return false; end if;
    end loop;
  end if;
  return true;
end;
$$;

-- 환불을 읽지 못하는 구 워커/엑셀 동기화가 이미 확인한 환불을 지우지 못하게 한다.
-- refunds: [] 는 새 워커가 해당 행의 환불 없음을 직접 확인한 경우에만 보낸다.
create or replace function public.preserve_makeedu_refunds()
returns trigger language plpgsql security invoker set search_path=public as $$
declare originals jsonb; old_originals jsonb; output jsonb:='[]'; line jsonb; matches jsonb; has_refunds boolean;
begin
  if jsonb_typeof(new.line_items) is distinct from 'array' then return new; end if;
  originals:=public.receipt_originals(new.line_items);
  if tg_op='UPDATE' and jsonb_typeof(old.line_items)='array' then
    old_originals:=public.receipt_originals(old.line_items);
    for line in select x from jsonb_array_elements(originals) x loop
      if not (line ? 'refunds') then
        select jsonb_agg(x) into matches from jsonb_array_elements(old_originals) x
          where public.receipt_line_identity(x)=public.receipt_line_identity(line)
          and jsonb_typeof(x->'refunds')='array' and jsonb_array_length(x->'refunds')>0;
        if matches is not null then
          if jsonb_array_length(matches)<>1 or matches->0->'amount' is distinct from line->'amount'
            or matches->0->'paid' is distinct from line->'paid' or matches->0->'discount' is distinct from line->'discount'
            or matches->0->'paidDate' is distinct from line->'paidDate' then
            raise exception '기존 환불 항목이 변경됐습니다. 환불 상세를 지원하는 워커로 다시 동기화해 주세요';
          end if;
          line:=line||jsonb_build_object('refunds',matches->0->'refunds');
        end if;
      end if;
      output:=output||jsonb_build_array(line);
    end loop;
    -- 합산 정보는 다음 normalize 트리거가 원본 및 기존 합산 설정으로 복원한다.
    new.line_items:=output;
    originals:=output;
  end if;
  select exists(select 1 from jsonb_array_elements(originals) x where jsonb_typeof(x->'refunds')='array' and jsonb_array_length(x->'refunds')>0) into has_refunds;
  if has_refunds and jsonb_array_length(originals)>0 and not exists(
    select 1 from jsonb_array_elements(originals) x where public.receipt_salary_amount(x) is distinct from 0
      or not exists(select 1 from jsonb_array_elements(coalesce(x->'refunds','[]')) r where r->>'status'='active' and r->>'type'='full')
  ) then new.status:='refunded'; end if;
  return new;
end;
$$;
drop trigger if exists invoices_00_preserve_refunds on public.invoices;
create trigger invoices_00_preserve_refunds before insert or update of line_items on public.invoices
for each row execute function public.preserve_makeedu_refunds();

create or replace function public.save_session_receipt_allocations(
  p_invoice_id uuid, p_expected_lines jsonb, p_rows jsonb
) returns integer language plpgsql security invoker set search_path = public as $$
declare inv public.invoices%rowtype; item jsonb; term public.invoice_session_terms%rowtype;
  line jsonb; grp record; result_count integer := 0;
begin
  if not coalesce(public.auth_billing_can_write(), false) then raise exception '수납 관리 권한이 없습니다'; end if;
  select * into inv from invoices where id = p_invoice_id and tenant_id = auth_tenant_id() for update;
  if not found or inv.status = 'void' then raise exception '유효한 청구서를 찾을 수 없습니다'; end if;
  if inv.line_items is distinct from p_expected_lines then raise exception '수납 내역이 변경되었습니다. 다시 열어 확인해 주세요'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '배분 형식이 올바르지 않습니다'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception '배분 형식이 올바르지 않습니다'; end if;
  if (select count(*) <> count(distinct r->>'termId') from jsonb_array_elements(p_rows) r) then raise exception '같은 반을 두 번 배분할 수 없습니다'; end if;
  perform id from invoice_session_terms where invoice_id = p_invoice_id order by id for update;
  -- 미확정 반을 더 연결할 수 있지만, 이미 확정한 반을 빼서 중복 정산되게 하지는 않는다.
  if jsonb_array_length(p_rows) > 0 and exists (
    select 1 from invoice_session_terms st where st.invoice_id = p_invoice_id and st.confirmed_sessions is not null
    and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'termId' = st.id::text)
  ) then raise exception '확정한 모든 반을 수납 항목에 연결해 주세요'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    select * into term from invoice_session_terms where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    if not found then raise exception '이 학생의 반에만 배분할 수 있습니다'; end if;
    if term.confirmed_at is distinct from (item->>'confirmedAt')::timestamptz or term.amount is distinct from (item->>'baseAmount')::numeric then
      raise exception '반 확정값이 변경되었습니다. 다시 열어 확인해 주세요';
    end if;
    if (item->>'lineIndex')::numeric < 0 or (item->>'lineIndex')::numeric <> trunc((item->>'lineIndex')::numeric) then raise exception '수납 항목을 확인해 주세요'; end if;
    line := inv.line_items->((item->>'lineIndex')::integer);
    if line is null or not public.receipt_is_tuition(line) then raise exception '수업 청구 항목에 연결해 주세요'; end if;
    if (item->>'amount') is null or (item->>'amount')::numeric < 0 or (item->>'amount')::numeric <> trunc((item->>'amount')::numeric) then raise exception '배분금액은 0 이상 원 단위여야 합니다'; end if;
    if term.pricing_mode <> 'monthly' and term.confirmed_sessions = 0 and (item->>'amount')::numeric > 0 then raise exception '0시수인 반에는 금액을 배분할 수 없습니다'; end if;
  end loop;
  for grp in select (value->>'lineIndex')::integer as idx, sum((value->>'amount')::numeric) as amount from jsonb_array_elements(p_rows) group by 1 loop
    if grp.amount is distinct from public.receipt_salary_amount(inv.line_items->grp.idx) then raise exception '반별 배분 합계가 할인 전 청구액과 일치해야 합니다'; end if;
  end loop;
  update invoice_session_terms set allocation_line_index = null, allocation_amount = null, allocation_source = null, allocation_base_amount = null where invoice_id = p_invoice_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    update invoice_session_terms set allocation_line_index = (item->>'lineIndex')::integer,
      allocation_amount = (item->>'amount')::numeric,
      allocation_source = inv.line_items->((item->>'lineIndex')::integer), allocation_base_amount = amount
      where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    result_count := result_count + 1;
  end loop;
  return result_count;
end;
$$;
revoke all on function public.save_session_receipt_allocations(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_session_receipt_allocations(uuid,jsonb,jsonb) to authenticated;
