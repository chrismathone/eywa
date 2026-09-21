-- 0278a — 회차 확정 **금액 이월**: 확정액보다 더 받은 몫을 다음 달 반으로 넘긴다 (원장 2026-09-21)
--
-- 원장(김지호 캡처 — 9월 '고등M_일 개별진도' 확정 95,625원인데 실납 105,625원): *"만원 남은걸 다음달로 금액 넘기는 기능이 없지?
-- '이월' 기능 추가해야겠어."* → 선택: **받을 반은 이월할 때 고른다**(그 학생의 다음 달 반 중 하나) · **수납액 분배에도 반영한다**.
--
-- 저장은 **보내는 쪽 한 곳**(이 달 회차 행)이다. 받는 달은 따로 적지 않고 지난 달 행을 읽어 붙인다 —
--   · 다음 달 회차 행은 대개 아직 없다(계획 갱신·확정 전). 받는 쪽에 쓰면 행이 생길 때까지 둘 곳이 없다.
--   · 한 곳에만 있어야 '이월 취소'가 한 번에 양쪽을 되돌린다(두 곳에 쓰면 한쪽만 남는 날이 온다).
-- 🔴 회차(시수) 이월(0134a carryover_out/in)과 **다른 물건**이다 — 그쪽은 급여 상한을 올리는 회차, 이쪽은 수납 배분 금액.
-- 🔴 수납 배분 원본(allocation_amount — 청구 항목 합계와 맞춘 값)은 안 건드린다. 분배·표시가 쓰는 '실납'만
--    보내는 달 −이월액, 받는 달 +이월액으로 읽는다(앱의 순수 함수 한 곳, money-carryover.ts).
--
-- ⚠️ `allocation_carry_class_id`에 FK를 걸지 않는다 — invoice_session_terms → classes에 FK가 둘이 되면 힌트 없는
--    `classes(...)` 임베드가 PGRST201로 죽는다(gotchas #94). 반이 지워지면 앱이 '받을 반 없음'으로 보인다.
-- ⚠️ 멱등(if not exists · create or replace). 적용 전에도 앱은 산다 — 이 컬럼들은 따로 조회하고 없으면 '이월 없음'으로 본다.
-- ⚠️ 알려진 한계: 0165a update 정책은 수납 쓰기 권한자에게 이 다섯 컬럼의 직접 PATCH(PostgREST)도 허용한다 — 같은 권한자만
--    할 수 있어 막지 않았다(앱의 유일한 쓰기 경로는 아래 RPC이고, 받을 반 검증은 서버 액션이 한다).

alter table public.invoice_session_terms
  add column if not exists allocation_carry_out numeric(12,0) not null default 0,
  add column if not exists allocation_carry_class_id uuid,
  add column if not exists allocation_carry_note text,
  add column if not exists allocation_carry_by uuid,
  add column if not exists allocation_carry_at timestamptz;

alter table public.invoice_session_terms drop constraint if exists invoice_session_terms_allocation_carry_check;
alter table public.invoice_session_terms add constraint invoice_session_terms_allocation_carry_check
  check (allocation_carry_out >= 0 and (allocation_carry_out = 0 or allocation_carry_class_id is not null));

comment on column public.invoice_session_terms.allocation_carry_out is
  '0278a: 이 반 실납(배분액) 중 확정액을 넘는 몫에서 **다음 달로 넘긴 금액**(원). 0=이월 없음. 받는 반은 allocation_carry_class_id.';
comment on column public.invoice_session_terms.allocation_carry_class_id is
  '0278a: 이월 금액을 받는 **다음 달** 반(같은 학생). FK 없음(임베드 모호성 방지 — gotchas #94).';

-- 받는 달 조회(지난 달 청구서의 이월 행)는 이월이 있는 행만 본다.
create index if not exists invoice_session_terms_allocation_carry_idx
  on public.invoice_session_terms (tenant_id, invoice_id) where allocation_carry_out > 0;

-- 저장·취소 한 문. 앱(서버 액션)이 유효 배분·다음 달 반을 먼저 확인하고, 여기서는 행을 잠근 채 불변식만 다시 본다.
create or replace function public.save_session_term_money_carryover(
  p_term_id uuid, p_amount numeric, p_class_id uuid, p_note text, p_expected_allocation numeric
) returns void language plpgsql security invoker set search_path = public as $$
declare term public.invoice_session_terms%rowtype; inv public.invoices%rowtype;
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
  if p_amount > term.allocation_amount - term.amount then
    raise exception '넘길 수 있는 금액은 최대 %원입니다(확정액보다 더 받은 몫)', to_char(greatest(term.allocation_amount - term.amount, 0), 'FM999,999,999,990');
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
