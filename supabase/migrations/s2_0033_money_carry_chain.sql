-- s2_0033_money_carry_chain.sql — 금액 이월: 받은 이월에서 남은 몫도 다음 달로 다시 넘긴다(연쇄 이월) · 2026-11-09
--
-- 원장 2026-11-09(조은준 9월 '중등E_중1 SKY' — 배분 312,000 + 8월 이월 +24,000 = 실납 336,000 · 확정 27시수 324,000):
--   *"조은준 학생이 이미 8월 -> 9월로 한번 이월을 받았는데, 9월에서 남은 시수를 10월로 이월이 안되게 기능이 막혀있음. 확인하고 해결"*.
-- 원인: '더 받은 몫'(이월할 수 있는 최대 금액)을 **배분액 − 확정액**으로만 셌다(0278a) — 받은 이월이 빠져 312,000 − 324,000 = 0원.
--   앱(`carrySurplus`)은 이제 **배분액 + 받은 이월 − 확정액**으로 센다. 이 함수는 저장 직전의 마지막 상한이라 같은 뜻으로 넓힌다.
--
-- 🔑 여기서 더하는 받은 이월 = 지난 달 청구서(취소 제외)에서 **이 학생 · 이 반**으로 넘긴 이월 합계 — **상한**이다.
--    그 이월이 지금도 유효한지 · 이 줄에 붙는지(같은 반 줄이 둘일 때)는 앱이 회차 확정 화면과 같은 판정으로 먼저 본다(서버 액션 #77).
--    DB가 그 판정을 다시 짜면 두 곳이 갈린다 — 여기는 '받은 돈보다 많이는 못 넘긴다'만 지킨다.
-- 🔴 서명(인자 5개)은 그대로다 — 옛 앱도 그대로 부른다(옛 앱이 보내는 값은 옛 상한 안이라 새 상한도 통과한다).
-- ⚠️ 나머지 본문(권한 · 행 잠금 · 취소 0원 · 청구서 확인 · 배분 대조 · 받을 반 확인 · 저장 칸)은 0278a 그대로다.
-- 다시 돌려도 같은 결과(create or replace).

begin;
set local lock_timeout = '5s';

create or replace function public.save_session_term_money_carryover(
  p_term_id uuid, p_amount numeric, p_class_id uuid, p_note text, p_expected_allocation numeric
) returns void language plpgsql security invoker set search_path = public as $$
declare term public.invoice_session_terms%rowtype; inv public.invoices%rowtype; carried_in numeric := 0; room numeric;
begin
  if not coalesce(public.auth_billing_can_write(), false) then raise exception '수납 관리 권한이 없습니다'; end if;
  select * into term from invoice_session_terms where id = p_term_id and tenant_id = auth_tenant_id() for update;
  if not found then raise exception '회차 행을 찾을 수 없습니다'; end if;
  if p_amount is null or p_amount < 0 or p_amount <> trunc(p_amount) then raise exception '이월 금액은 0 이상 원 단위여야 합니다'; end if;
  -- 취소(0원)는 청구서 상태와 무관하게 받는다 — 막으면 취소된 청구서에 남은 이월을 영영 못 지운다.
  if p_amount = 0 then
    update invoice_session_terms set allocation_carry_out = 0, allocation_carry_class_id = null, allocation_carry_note = null,
      allocation_carry_by = auth.uid(), allocation_carry_at = now() where id = p_term_id;
    return;
  end if;
  select * into inv from invoices where id = term.invoice_id and tenant_id = auth_tenant_id();
  if not found or inv.status = 'void' then raise exception '유효한 청구서를 찾을 수 없습니다'; end if;
  if term.confirmed_sessions is null or term.amount is null or term.allocation_amount is null then
    raise exception '시수 확정과 수납 배분을 마친 반만 이월할 수 있습니다';
  end if;
  if term.allocation_amount is distinct from p_expected_allocation then raise exception '배분 금액이 바뀌었습니다. 다시 열어 확인해 주세요'; end if;
  -- s2_0033: 지난 달에서 이 학생 · 이 반으로 받은 이월도 더 받은 몫이다(연쇄 이월) — 상한만 본다(유효성은 앱이 먼저 판정).
  if term.class_id is not null then
    select coalesce(sum(t.allocation_carry_out), 0) into carried_in
      from invoice_session_terms t join invoices i on i.id = t.invoice_id
     where t.tenant_id = auth_tenant_id() and i.tenant_id = auth_tenant_id()
       and i.student_id = inv.student_id and i.status <> 'void'
       and i.period = to_char(to_date(inv.period || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM')
       and t.allocation_carry_out > 0 and t.allocation_carry_class_id = term.class_id;
  end if;
  room := term.allocation_amount + carried_in - term.amount;
  if p_amount > room then
    raise exception '넘길 수 있는 금액은 최대 %원입니다(확정액보다 더 받은 몫)', to_char(greatest(room, 0), 'FM999,999,999,990');
  end if;
  if p_class_id is null or not exists (select 1 from classes where id = p_class_id and tenant_id = auth_tenant_id()) then
    raise exception '받을 반을 골라 주세요';
  end if;
  update invoice_session_terms set allocation_carry_out = p_amount, allocation_carry_class_id = p_class_id,
    allocation_carry_note = nullif(btrim(coalesce(p_note, '')), ''), allocation_carry_by = auth.uid(), allocation_carry_at = now()
    where id = p_term_id;
end;
$$;
revoke all on function public.save_session_term_money_carryover(uuid, numeric, uuid, text, numeric) from public, anon;
grant execute on function public.save_session_term_money_carryover(uuid, numeric, uuid, text, numeric) to authenticated;

commit;
