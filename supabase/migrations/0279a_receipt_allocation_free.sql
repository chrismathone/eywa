-- 0279a — 수납 **자유 배분**(관리자 이상): 수납 항목에 연결하지 않고 반마다 금액만 — 합계 ≤ 수업 청구액 (원장 2026-09-21)
--
-- 원장: *"총 금액(청구액)은 변하지 않는선에서 출결행에 다 분배시킬 수 있어야함. 언제 이런저런일이 있을지 알 수 없으니까."* →
-- 선택 '총액만 맞으면 자유 배분' · *"스마트하게 자동 배분되는건 자동 배분이 우선적으로 되고, 관리자 이상급이 자유롭게 수납 배분을
-- 커스텀할 수 있게"* · *"원칙은 '받은 돈보다 더 지급할 순 없다.' '덜 지급하는건 괜찮다.'"*
--
-- 🔑 항목별 배분 함수(`save_session_receipt_allocations`, 0269a)는 **그대로**다 — 자유 배분은 이 새 함수 하나로만 저장한다.
-- 저장 모양은 0269a '연결 안 함 0원' 행과 같다: allocation_line_index = null · allocation_source = 저장 때 청구 항목 전체(배열) ·
-- allocation_base_amount = 확정금액. 금액만 0이 아닐 수 있다. 앱(`effectiveAllocations`)은 청구서에 **연결 행이 하나도 없을 때**
-- 이 행들을 자유 배분으로 읽고, 청구 항목·확정금액이 저장 때 그대로이며 합계 ≤ 수업 청구액일 때만 유효로 본다.
-- 🔴 더 못 준다: 합계 ≤ 수업 청구 항목의 급여 기준액 합(`receipt_salary_amount` — 항목별 배분과 같은 기준: 할인 전·환불 반영). 덜 주는 건 괜찮다.
-- 🔴 관리자 이상만: 원장·관리자(system_role master·admin) + super_admin(0021a `is_super_admin`). 앱(서버 액션)도 같은 판정을 먼저 한다(#77).
--    수납 쓰기 권한만으로 회차 행을 직접 고쳐(PostgREST PATCH) 같은 모양을 만드는 길은 아래 트리거가 막는다.
-- ⚠️ 멱등(create or replace · drop trigger if exists). 적용 전에는 자유 배분 저장만 '기능이 아직 켜지지 않았습니다'로 거절된다.

create or replace function public.save_session_receipt_allocations_free(
  p_invoice_id uuid, p_expected_lines jsonb, p_rows jsonb
) returns integer language plpgsql security invoker set search_path = public as $$
declare inv public.invoices%rowtype; item jsonb; term public.invoice_session_terms%rowtype;
  total numeric := 0; allocated numeric := 0; result_count integer := 0;
begin
  if not coalesce(public.auth_billing_can_write(), false) then raise exception '수납 관리 권한이 없습니다'; end if;
  if not (coalesce(public.auth_system_role(), '') in ('master', 'admin') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception '자유 배분은 관리자 이상만 할 수 있습니다';
  end if;
  select * into inv from invoices where id = p_invoice_id and tenant_id = auth_tenant_id() for update;
  if not found or inv.status = 'void' then raise exception '유효한 청구서를 찾을 수 없습니다'; end if;
  if inv.line_items is distinct from p_expected_lines then raise exception '수납 내역이 변경되었습니다. 다시 열어 확인해 주세요'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception '배분 형식이 올바르지 않습니다';
  end if;
  if (select count(*) <> count(distinct r->>'termId') from jsonb_array_elements(p_rows) r) then raise exception '같은 반을 두 번 배분할 수 없습니다'; end if;
  perform id from invoice_session_terms where invoice_id = p_invoice_id order by id for update;
  -- 확정한 반은 전부 싣는다(0원이어도) — 빼면 그 반이 '배분 재확인'으로 남는다.
  if exists (
    select 1 from invoice_session_terms st where st.invoice_id = p_invoice_id and st.confirmed_sessions is not null
    and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'termId' = st.id::text)
  ) then raise exception '확정한 반은 모두 넣어 주세요'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    select * into term from invoice_session_terms where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    if not found then raise exception '이 학생의 반에만 배분할 수 있습니다'; end if;
    if term.confirmed_at is distinct from (item->>'confirmedAt')::timestamptz or term.amount is distinct from (item->>'baseAmount')::numeric then
      raise exception '반 확정값이 변경되었습니다. 다시 열어 확인해 주세요';
    end if;
    if (item->>'amount') is null or (item->>'amount')::numeric < 0 or (item->>'amount')::numeric <> trunc((item->>'amount')::numeric) then
      raise exception '배분금액은 0 이상 원 단위여야 합니다';
    end if;
    if term.confirmed_sessions is null and (item->>'amount')::numeric = 0 then raise exception '미확정 반은 금액을 적었을 때만 저장합니다'; end if;
    if term.pricing_mode <> 'monthly' and term.confirmed_sessions = 0 and (item->>'amount')::numeric > 0 then raise exception '0시수인 반에는 금액을 배분할 수 없습니다'; end if;
    allocated := allocated + (item->>'amount')::numeric;
  end loop;
  select coalesce(sum(greatest(coalesce(public.receipt_salary_amount(li), 0), 0)) filter (where public.receipt_is_tuition(li)), 0) into total
    from jsonb_array_elements(case when jsonb_typeof(inv.line_items) = 'array' then inv.line_items else '[]'::jsonb end) li;
  if allocated > total then
    raise exception '수업 청구액 %원보다 많이 나눌 수 없습니다 — 지금 %원',
      to_char(total, 'FM999,999,999,990'), to_char(allocated, 'FM999,999,999,990');
  end if;
  update invoice_session_terms set allocation_line_index = null, allocation_amount = null, allocation_source = null, allocation_base_amount = null
    where invoice_id = p_invoice_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    update invoice_session_terms set allocation_line_index = null, allocation_amount = (item->>'amount')::numeric,
      allocation_source = inv.line_items, allocation_base_amount = amount
      where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    result_count := result_count + 1;
  end loop;
  return result_count;
end;
$$;
revoke all on function public.save_session_receipt_allocations_free(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_session_receipt_allocations_free(uuid, jsonb, jsonb) to authenticated;

-- 🔴 직접 쓰기 막기 — 수납 쓰기 권한(회계 포함)만 있으면 회차 행 update 정책(0165a)을 통과하므로, PostgREST로 allocation_* 칸을 바로
--    고쳐 '연결 없이 양수'(= 자유 배분) 모양을 만들 수 있었다. 그 모양으로 **바꾸는** 쓰기는 관리자 이상만 통과시킨다.
--    service_role(서버 관리 작업 — auth.uid() 없음)은 통과. 항목별 함수(0269a)는 연결 행·0원 행만 만들어 걸리지 않는다.
--    기준액·스냅샷(allocation_base_amount·allocation_source)도 지켜본다 — 그 둘을 지금 값에 맞춰 쓰면 무효가 된 관리자 자유 배분이
--    관리자 없이 다시 유효해진다. 시수 확정이 기준액을 채우는 것(0267b 트리거가 NEW를 고친다)은 UPDATE 대상 칸이 아니라 걸리지 않는다.
create or replace function public.guard_session_free_allocation()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.allocation_line_index is null and coalesce(new.allocation_amount, 0) > 0
    and (tg_op = 'INSERT' or old.allocation_line_index is not null or old.allocation_amount is distinct from new.allocation_amount
      or old.allocation_base_amount is distinct from new.allocation_base_amount or old.allocation_source is distinct from new.allocation_source)
    and auth.uid() is not null
    and not (coalesce(public.auth_system_role(), '') in ('master', 'admin') or coalesce(public.is_super_admin(auth.uid()), false)) then
    raise exception '자유 배분은 관리자 이상만 할 수 있습니다';
  end if;
  return new;
end;
$$;
drop trigger if exists session_free_allocation_guard on public.invoice_session_terms;
create trigger session_free_allocation_guard before insert or update of allocation_line_index, allocation_amount, allocation_base_amount, allocation_source on public.invoice_session_terms
for each row execute function public.guard_session_free_allocation();

-- 먼저 저장한 배분은 최초 시수 확정에 이어진다(0267b) — **자유 배분 행도** 같게. 안 그러면 미확정 반(보강 방문 줄)에 자유 배분한 뒤
-- 그 반을 확정하는 순간 기준액이 비어 청구서 전체 배분이 '재확인'으로 떨어지고 그 달 분배 저장이 막힌다(적대 리뷰 2026-09-21).
create or replace function public.adopt_session_receipt_allocation_basis()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if old.confirmed_sessions is null and new.confirmed_sessions is not null
    and old.allocation_base_amount is null
    and (old.allocation_line_index is not null or coalesce(old.allocation_amount, 0) > 0)
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
