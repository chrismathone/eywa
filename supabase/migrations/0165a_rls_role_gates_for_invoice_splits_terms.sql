-- 0165a — 청구 계열 나머지 2테이블(invoice_teacher_splits · invoice_session_terms)에도 역할 게이트.
--
-- 배경(0164a 적대 검증의 완결성 비평): 0158a가 invoices·expenses를 잠갔지만 **청구 계열은 4테이블**이고
-- 나머지 둘은 `*_tenant_isolation`(역할을 안 봄) 하나뿐이라, 0158a가 막았다는 위협이 그대로 성립했다 —
--   · billing 권한이 없는 teacher(31계정)·viewer(8계정)가 자기 access token으로
--     `GET /rest/v1/invoice_teacher_splits?select=teacher_name,confirmed_amount,actual_amount`를 호출하면
--     **전 강사의 월별 분배액**을 그대로 받는다. CLAUDE.md가 '외부 AI 전송 금지'로 분류한 급여 계열과 같은 등급이다.
--   · `invoice_session_terms`도 회당 단가(unit_price)·금액 스냅샷을 담는다(1,337행).
-- 0158a는 textbook_orders를 "의도적 제외"로 **기록**했으나 이 둘은 언급조차 없어 닫힌 것으로 오인됐다.
--
-- ⚠️ 락아웃 없음을 코드로 확인하고 잠근다(gotchas #60 fail-open 원칙 — 잠그기 전에 소비처 전수):
--   · 쓰기 3곳(session-terms/server/actions.ts · splits-actions.ts)은 **이미 전부**
--     `canWriteTenant(user.systemRole, "billing")`을 통과한다 → DB 게이트가 앱 게이트의 정확한 미러다.
--   · 읽기는 billing 화면(session-terms/server/{queries,splits-queries}.ts · payroll settlement-queries.ts가
--     여는 수납 면탭)과 **출석부 '강사 전체 보기' 금액 열**뿐인데, 후자는 `user.systemRole === "master"`
--     조건에서만 호출된다(attendance/page.tsx) — master는 auth_menu_access가 항상 'full'이라 통과.
--   · makeedu 동기화·cron은 service_role(BYPASSRLS)이라 무관.
--
-- ⚠️ 게이트 함수는 **반드시 `(select f())`로 감싼다** — 컬럼을 안 쓰는 순수 불리언을 맨몸으로 쓰면
--    스캔한 행마다 호출된다(gotchas #91, 0164a에서 2.1초로 실측). 여기서 풀지 말 것.
--
-- 멱등: drop policy if exists → create policy. 롤백: 아래 8개 정책을 drop(기존 tenant_isolation은 무접촉).

-- ── invoice_teacher_splits (강사별 분배액·단가 스냅샷 = 급여 재료) ──────────────
drop policy if exists invoice_teacher_splits_role_gate_select on public.invoice_teacher_splits;
create policy invoice_teacher_splits_role_gate_select on public.invoice_teacher_splits
  as restrictive for select to authenticated
  using ((select public.auth_billing_can_read()));

drop policy if exists invoice_teacher_splits_role_gate_insert on public.invoice_teacher_splits;
create policy invoice_teacher_splits_role_gate_insert on public.invoice_teacher_splits
  as restrictive for insert to authenticated
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoice_teacher_splits_role_gate_update on public.invoice_teacher_splits;
create policy invoice_teacher_splits_role_gate_update on public.invoice_teacher_splits
  as restrictive for update to authenticated
  using ((select public.auth_billing_can_write()))
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoice_teacher_splits_role_gate_delete on public.invoice_teacher_splits;
create policy invoice_teacher_splits_role_gate_delete on public.invoice_teacher_splits
  as restrictive for delete to authenticated
  using ((select public.auth_billing_can_write()));

-- ── invoice_session_terms (회당 단가·확정 회차·금액 스냅샷) ────────────────────
drop policy if exists invoice_session_terms_role_gate_select on public.invoice_session_terms;
create policy invoice_session_terms_role_gate_select on public.invoice_session_terms
  as restrictive for select to authenticated
  using ((select public.auth_billing_can_read()));

drop policy if exists invoice_session_terms_role_gate_insert on public.invoice_session_terms;
create policy invoice_session_terms_role_gate_insert on public.invoice_session_terms
  as restrictive for insert to authenticated
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoice_session_terms_role_gate_update on public.invoice_session_terms;
create policy invoice_session_terms_role_gate_update on public.invoice_session_terms
  as restrictive for update to authenticated
  using ((select public.auth_billing_can_write()))
  with check ((select public.auth_billing_can_write()));

drop policy if exists invoice_session_terms_role_gate_delete on public.invoice_session_terms;
create policy invoice_session_terms_role_gate_delete on public.invoice_session_terms
  as restrictive for delete to authenticated
  using ((select public.auth_billing_can_write()));
