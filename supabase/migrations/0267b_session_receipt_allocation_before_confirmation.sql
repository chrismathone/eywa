-- 2026-09-16 후속: 시수 확정 전에도 수납 연결·배분을 저장한다.
-- 배분 저장은 confirmed_sessions/unit_price/amount를 바꾸지 않는다.
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
    if line is null or coalesce(line->>'kind','') not in ('', '수업', 'tuition', '수강료') then raise exception '수업 청구 항목에 연결해 주세요'; end if;
    if (item->>'amount') is null or (item->>'amount')::numeric < 0 or (item->>'amount')::numeric <> trunc((item->>'amount')::numeric) then raise exception '배분금액은 0 이상 원 단위여야 합니다'; end if;
    if term.pricing_mode <> 'monthly' and term.confirmed_sessions = 0 and (item->>'amount')::numeric > 0 then raise exception '0시수인 반에는 금액을 배분할 수 없습니다'; end if;
  end loop;
  for grp in select (value->>'lineIndex')::integer as idx, sum((value->>'amount')::numeric) as amount from jsonb_array_elements(p_rows) group by 1 loop
    if grp.amount is distinct from (inv.line_items->grp.idx->>'amount')::numeric then raise exception '반별 배분 합계가 할인 전 청구액과 일치해야 합니다'; end if;
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

-- 먼저 저장한 배분은 최초 시수 확정에 이어진다. 이후 확정금액 변경은 기존 stale 검사로 안내한다.
create or replace function public.adopt_session_receipt_allocation_basis()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.confirmed_sessions is null and new.confirmed_sessions is not null
    and old.allocation_line_index is not null and old.allocation_base_amount is null
    and new.allocation_line_index is not distinct from old.allocation_line_index
    and new.allocation_amount is not distinct from old.allocation_amount then
    if new.pricing_mode <> 'monthly' and new.confirmed_sessions = 0 and new.allocation_amount > 0 then
      raise exception '배분금액이 있는 반은 0시수로 확정할 수 없습니다. 시수 또는 배분금액을 확인해 주세요';
    end if;
    new.allocation_base_amount := new.amount;
  end if;
  return new;
end;
$$;
drop trigger if exists session_receipt_allocation_basis on public.invoice_session_terms;
create trigger session_receipt_allocation_basis before update of confirmed_sessions on public.invoice_session_terms
for each row execute function public.adopt_session_receipt_allocation_basis();
