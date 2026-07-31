-- 수납/지출 역할 게이트 RLS를 **행마다 평가**하던 것을 statement 1회(InitPlan)로 — 수납관리 창 체감 지연의 주범.
--
-- 배경: 0158a가 invoices·expenses에 RESTRICTIVE 역할 게이트를 걸었다(강사·뷰어가 계좌번호까지 읽던 구멍을
-- 막은 옳은 조치). 그런데 조건이 **컬럼을 안 쓰는 순수 불리언 함수 호출**(`auth_billing_can_read()`)이라
-- Postgres가 이걸 상수로 접지 못하고 **스캔한 행마다 호출**한다. STABLE 표시로는 안 접힌다 —
-- STABLE은 "한 문장 안에서 값이 안 변한다"는 보장일 뿐, 플래너가 1회 평가로 바꿔주진 않는다.
--
-- 실측(2026-07-31, injaewon 프로덕션 · authenticated 롤 + 실 사용자 클레임):
--   · `auth_billing_can_read()` 단독 1회 = **14ms** (내부에서 users + tenant_settings jsonb lateral 조회)
--   · invoices 2026-07 count(402행)          273ms → **19ms**
--   · invoice_periods()(3,225행 스캔)      2,148ms → **19ms**
--   · invoices 전건 select(3,225행)        2,046ms → **155ms**
--   · EXPLAIN 실행시간                     2,120ms → **2.7ms**  (Filter: auth_… → `Filter: (InitPlan 1).col1`)
--
-- 고치는 법 = 함수 호출을 **스칼라 서브쿼리로 감싼다**(`(select f())`). 플래너가 InitPlan으로 끌어올려
-- 문장당 한 번만 실행한다(Supabase RLS 성능 권고와 동일한 패턴).
--
-- ⚠️ **권한은 1비트도 안 바뀐다.** 감싼 함수는 전부 인자 없는 STABLE 함수라 문장 안에서 값이 동일하다 —
--    같은 불리언을 3,225번 계산하던 걸 1번 계산할 뿐이다. 컬럼을 쓰는 항(`created_by = auth.uid()`,
--    `restricted is not true`)은 **행마다 평가돼야 하므로 그대로 둔다**(감싸면 안 된다).
-- ⚠️ 앞으로 **컬럼을 참조하지 않는 게이트 함수는 정책에 맨몸으로 쓰지 말 것** — 반드시 `(select f())`.
--    맨몸으로 쓰면 테이블이 커질수록 조용히 느려진다(에러가 아니라 지연이라 아무도 안 알려준다).

-- ── invoices ────────────────────────────────────────────────────────────────
alter policy invoices_role_gate_select on public.invoices
  using ((select public.auth_billing_can_read()));

alter policy invoices_role_gate_update on public.invoices
  using ((select public.auth_billing_can_write()))
  with check ((select public.auth_billing_can_write()));

alter policy invoices_role_gate_delete on public.invoices
  using ((select public.auth_billing_can_write()));

alter policy invoices_role_gate_insert on public.invoices
  with check ((select public.auth_billing_can_write()));

-- ── expenses (지출결의서: 담당자 본인 건은 제출 권한으로도 열람/수정 — created_by는 컬럼이라 행마다) ──
alter policy expenses_role_gate_select on public.expenses
  using (
    (select public.auth_billing_can_read())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

alter policy expenses_role_gate_update on public.expenses
  using (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  )
  with check (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

alter policy expenses_role_gate_delete on public.expenses
  using (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );

alter policy expenses_role_gate_insert on public.expenses
  with check (
    (select public.auth_billing_can_write())
    or ((select public.auth_expense_can_submit()) and created_by = (select auth.uid()))
  );
