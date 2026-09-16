-- 2026-09-16: 출석부 단가에 맞춰 시수로 확정. 기존 확정은 days 스냅샷으로 보존한다.
alter table public.invoice_session_terms
  alter column planned_sessions type numeric(6,1),
  alter column confirmed_sessions type numeric(6,1),
  alter column carryover_out type numeric(6,1),
  alter column carryover_in type numeric(6,1),
  add column if not exists quantity_basis text not null default 'days' check (quantity_basis in ('days', 'attendance_units')),
  add column if not exists allocation_line_index integer,
  add column if not exists allocation_amount numeric(12,0),
  add column if not exists allocation_source jsonb,
  add column if not exists allocation_base_amount numeric(12,0);
alter table public.invoice_teacher_splits alter column confirmed_sessions type numeric(6,1);

create or replace function public.session_term_attendance(p_period text)
returns table (invoice_id uuid, class_id uuid, consumed numeric)
language sql stable security invoker set search_path = public as $$
  with terms as (
    select st.invoice_id, st.class_id, i.student_id,
      case when st.confirmed_sessions is null then 'attendance_units' else st.quantity_basis end as quantity_basis
    from invoice_session_terms st
    join invoices i on i.id = st.invoice_id and i.tenant_id = st.tenant_id
    where st.tenant_id = auth_tenant_id() and i.period = p_period
  ), eff as (
    select distinct on (ar.student_id, ar.class_id, ar.session_date, ar.slot_start)
      ar.student_id, ar.class_id, ar.session_date, ar.status, ar.session_units
    from attendance_records ar
    where ar.tenant_id = auth_tenant_id() and to_char(ar.session_date, 'YYYY-MM') = p_period
    order by ar.student_id, ar.class_id, ar.session_date, ar.slot_start, ar.recorded_at desc, ar.id desc
  )
  select t.invoice_id, t.class_id,
    case when t.quantity_basis = 'attendance_units' then
      coalesce(sum(coalesce(e.session_units, 1)) filter (where e.status in ('present', 'late', 'early_leave', 'makeup')), 0)
    else count(distinct e.session_date) filter (where e.status in ('present', 'late', 'early_leave', 'makeup')) end::numeric(6,1)
  from terms t
  left join eff e on e.student_id = t.student_id and e.class_id = t.class_id
  group by t.invoice_id, t.class_id, t.quantity_basis
  order by t.invoice_id, t.class_id;
$$;

comment on function public.session_term_attendance(text) is
  '0267a: 새 확정은 출석부 시수 합(학생·반·날짜·교시별 최신 소비 기록). 기존 확정은 quantity_basis=days로 일수 비교 보존. 수납 원본·출결 원본은 변경하지 않음.';

-- 수납 원본은 수정하지 않고 학생의 전체 연결·배분을 한 트랜잭션으로 교체한다.
-- 직접 RPC 호출도 권한·동시수정·청구액 합계·같은 학생의 확정 반인지 모두 검증한다.
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
  if jsonb_array_length(p_rows) > 0 and jsonb_array_length(p_rows) <> (select count(*) from invoice_session_terms where invoice_id = p_invoice_id and confirmed_sessions is not null) then
    raise exception '확정한 모든 반을 수납 항목에 연결해 주세요';
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    select * into term from invoice_session_terms where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    if not found or term.confirmed_sessions is null or term.amount is null then raise exception '확정한 반만 배분할 수 있습니다'; end if;
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
