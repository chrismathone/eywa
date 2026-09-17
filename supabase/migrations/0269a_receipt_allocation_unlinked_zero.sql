-- 0269a — 수납 연결·배분: 연결할 수납 항목이 없는 **확정 반은 0원으로 저장** (0267e 후속)
--
-- 원장(2026-09-17, 배분 창 캡처와 함께): *"배분 금액이 없으면 0 으로 입력해서 저장할 수 있게 해줄것."* →
-- *"혹은 연결 안함 처리시 자동으로 0"*. 월초에 끝난 반(LS4b 9/1 종료)처럼 청구서에 그 반 수납 항목이 없으면,
-- 0267e는 "확정한 모든 반을 수납 항목에 연결"을 요구해 저장 자체가 막혔다.
--
-- 바꾸는 것 — `save_session_receipt_allocations` 한 함수:
--   · p_rows의 `lineIndex`가 null(또는 키 없음)인 행 = "연결 안 함 · 0원". 금액은 0만, 시수 확정한 반만.
--   · 🔴 0원 행은 **빠뜨린 연결을 조용히 덮지 못한다**(적대적 리뷰 2026-09-17): 같은 저장에 연결한 행이 하나 이상 있어야 하고,
--     금액이 있는 수업 수납 항목이 어느 반에도 안 붙은 채 남으면 0원 행마다 확인 표식(`ackUnlinked: true`)이 있어야 한다
--     (화면이 남는 항목을 보여 주고 확인받는다 — 받을 반이 없는 특강 항목이 있는 청구서에서도 0원을 적을 수 있게 막지는 않는다).
--     "이름이 맞는 항목이 있는 반은 0원 불가"는 반 이름 판정이 앱에 있어 서버 액션이 막는다.
--   · 그 행은 allocation_line_index = null · allocation_amount = 0 · allocation_base_amount = 확정금액 ·
--     allocation_source = **저장 때의 청구 항목 전체(배열)** 로 쓴다. 앱(effectiveAllocations)은 그중 **수업 수납 항목**이
--     지금과 같고(순서·교재 등 다른 항목은 안 본다) 확정금액이 그대로일 때만 0원으로 인정한다 — 새 수납이 들어오면 재확인으로 돌아간다.
--   · 합계 검사(항목별 배분 합계 = 할인 전 청구액)는 연결한 행만 센다.
-- 그 밖의 검사·잠금·문구는 0267e 그대로다. 연결 재배치 트리거(relink)는 항목이 있는 행만 다루므로 손대지 않는다.
--
-- ⚠️ 멱등(create or replace). 이 파일을 적용하기 전(0267e 함수)에는 새 앱이 보낸 0원 행을 '수업 청구 항목에 연결해 주세요'로
--    거절한다(화면은 죽지 않는다). 적용 뒤 옛 앱은 0원 행을 재확인 대상으로 보고 분배 저장을 멈춘다(돈이 틀어지지는 않는다).

create or replace function public.save_session_receipt_allocations(
  p_invoice_id uuid, p_expected_lines jsonb, p_rows jsonb
) returns integer language plpgsql security invoker set search_path = public as $$
declare inv public.invoices%rowtype; item jsonb; term public.invoice_session_terms%rowtype;
  line jsonb; grp record; result_count integer := 0; linked boolean;
begin
  if not coalesce(public.auth_billing_can_write(), false) then raise exception '수납 관리 권한이 없습니다'; end if;
  select * into inv from invoices where id = p_invoice_id and tenant_id = auth_tenant_id() for update;
  if not found or inv.status = 'void' then raise exception '유효한 청구서를 찾을 수 없습니다'; end if;
  if inv.line_items is distinct from p_expected_lines then raise exception '수납 내역이 변경되었습니다. 다시 열어 확인해 주세요'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '배분 형식이 올바르지 않습니다'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception '배분 형식이 올바르지 않습니다'; end if;
  if (select count(*) <> count(distinct r->>'termId') from jsonb_array_elements(p_rows) r) then raise exception '같은 반을 두 번 배분할 수 없습니다'; end if;
  perform id from invoice_session_terms where invoice_id = p_invoice_id order by id for update;
  -- 미확정 반을 더 연결할 수 있지만, 이미 확정한 반을 빼서 중복 정산되게 하지는 않는다(연결 안 함 = 0원 행도 '포함'이다).
  if jsonb_array_length(p_rows) > 0 and exists (
    select 1 from invoice_session_terms st where st.invoice_id = p_invoice_id and st.confirmed_sessions is not null
    and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'termId' = st.id::text)
  ) then raise exception '확정한 모든 반을 수납 항목에 연결하거나 0원으로 저장해 주세요'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) r where not coalesce(jsonb_typeof(r->'lineIndex') = 'number', false)) then
    if not exists (select 1 from jsonb_array_elements(p_rows) r where jsonb_typeof(r->'lineIndex') = 'number') then
      raise exception '수납 항목에 한 반 이상 연결한 뒤 남은 반을 0원으로 저장할 수 있습니다';
    end if;
    if exists (
      select 1 from jsonb_array_elements(inv.line_items) with ordinality l(line, ord)
      where public.receipt_is_tuition(l.line) and coalesce(public.receipt_salary_amount(l.line), 0) > 0
        and not exists (select 1 from jsonb_array_elements(p_rows) r
          where jsonb_typeof(r->'lineIndex') = 'number' and (r->>'lineIndex')::numeric = l.ord - 1)
    ) and exists (
      select 1 from jsonb_array_elements(p_rows) r
      where not coalesce(jsonb_typeof(r->'lineIndex') = 'number', false) and r->'ackUnlinked' is distinct from 'true'::jsonb
    ) then raise exception '어느 반에도 연결하지 않은 수업 항목이 남습니다. 확인한 뒤 다시 저장해 주세요'; end if;
  end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    select * into term from invoice_session_terms where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    if not found then raise exception '이 학생의 반에만 배분할 수 있습니다'; end if;
    if term.confirmed_at is distinct from (item->>'confirmedAt')::timestamptz or term.amount is distinct from (item->>'baseAmount')::numeric then
      raise exception '반 확정값이 변경되었습니다. 다시 열어 확인해 주세요';
    end if;
    if (item->>'amount') is null or (item->>'amount')::numeric < 0 or (item->>'amount')::numeric <> trunc((item->>'amount')::numeric) then raise exception '배분금액은 0 이상 원 단위여야 합니다'; end if;
    linked := coalesce(jsonb_typeof(item->'lineIndex') = 'number', false);
    if not linked then
      if item->'lineIndex' is not null and jsonb_typeof(item->'lineIndex') <> 'null' then raise exception '수납 항목을 확인해 주세요'; end if;
      if term.confirmed_sessions is null then raise exception '수납 항목에 연결하지 않는 반은 시수를 확정한 뒤 0원으로 저장할 수 있습니다'; end if;
      if (item->>'amount')::numeric <> 0 then raise exception '수납 항목에 연결하지 않은 반은 0원만 저장할 수 있습니다'; end if;
      continue;
    end if;
    if (item->>'lineIndex')::numeric < 0 or (item->>'lineIndex')::numeric <> trunc((item->>'lineIndex')::numeric) then raise exception '수납 항목을 확인해 주세요'; end if;
    line := inv.line_items->((item->>'lineIndex')::integer);
    if line is null or not public.receipt_is_tuition(line) then raise exception '수업 청구 항목에 연결해 주세요'; end if;
    if term.pricing_mode <> 'monthly' and term.confirmed_sessions = 0 and (item->>'amount')::numeric > 0 then raise exception '0시수인 반에는 금액을 배분할 수 없습니다'; end if;
  end loop;
  for grp in select (value->>'lineIndex')::integer as idx, sum((value->>'amount')::numeric) as amount
    from jsonb_array_elements(p_rows) where jsonb_typeof(value->'lineIndex') = 'number' group by 1 loop
    if grp.amount is distinct from public.receipt_salary_amount(inv.line_items->grp.idx) then raise exception '반별 배분 합계가 할인 전 청구액과 일치해야 합니다'; end if;
  end loop;
  update invoice_session_terms set allocation_line_index = null, allocation_amount = null, allocation_source = null, allocation_base_amount = null where invoice_id = p_invoice_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(item->'lineIndex') = 'number' then
      update invoice_session_terms set allocation_line_index = (item->>'lineIndex')::integer,
        allocation_amount = (item->>'amount')::numeric,
        allocation_source = inv.line_items->((item->>'lineIndex')::integer), allocation_base_amount = amount
        where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    else
      update invoice_session_terms set allocation_line_index = null, allocation_amount = 0,
        allocation_source = inv.line_items, allocation_base_amount = amount
        where id = (item->>'termId')::uuid and invoice_id = p_invoice_id;
    end if;
    result_count := result_count + 1;
  end loop;
  return result_count;
end;
$$;
revoke all on function public.save_session_receipt_allocations(uuid,jsonb,jsonb) from public, anon;
grant execute on function public.save_session_receipt_allocations(uuid,jsonb,jsonb) to authenticated;
