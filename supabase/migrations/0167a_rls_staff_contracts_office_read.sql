-- 0167a — 직원 **계약 조건**을 테넌트 전원이 읽던 것을 사무실로 좁힌다.
--
-- 발견(0165a 작업 중 인접 조사): `staff_contracts_tenant_read`(0149a)가
--     for select using (tenant_id = auth_tenant_id())
-- 라 **역할을 전혀 안 본다.** 앱은 사무실 전용인데(`/staff/[id]`는 `requireAccess("staff")`,
-- MENU_ACCESS.staff = master/admin/manager/accountant만 full) DB가 열려 있어,
-- teacher(31계정)·viewer(8계정)가 자기 토큰으로 `GET /rest/v1/staff_contracts?select=user_id,terms,memo`를
-- 호출하면 **전 직원 계약 조건 132행**을 그대로 받는다. gotchas #77 "화면에서만 잠갔다"의 교과서 사례다.
-- 민감도: `terms` 132행 중 **54행이 급여성 문구**(급여/월급/시급/연봉/수당/만원 등)를 담고 있다 —
-- CLAUDE.md가 '외부 AI 전송 금지'로 분류한 급여 계열과 같은 등급.
--
-- ⚠️ 락아웃 방지(gotchas #60): 잠그기 전에 소비처를 전수 확인했다.
--   · 유일한 읽기 = `getStaffContracts`(staff/server/contract-queries.ts) ← `/staff/[id]` basic-info 탭뿐.
--     그 라우트는 이미 `requireAccess("staff")`를 통과한다 → DB 게이트가 앱 게이트의 정확한 미러다.
--   · **`/me`(내 정보)는 계약을 읽지 않는다**(확인함) — 본인 열람 예외가 필요 없다. 나중에 본인 계약
--     보기를 만들면 `or user_id = (select auth.uid())`를 더할 것(지금 넣으면 앱에 없는 경로를 DB만 여는 셈).
--   · 쓰기(contract-actions.ts)는 이미 `canManageStaff`(master/admin/manager) 게이트 — 기존
--     `staff_contracts_office_write`(0149a)가 그대로 담당하므로 여기서 건드리지 않는다.
--   · counselor는 injaewon override(`staff: readonly`)로 통과한다 — 화면과 동일.
--
-- ⚠️ 이 게이트를 위해 **0158a의 DEFAULTS jsonb에 `staff` 행을 추가**했다(그 전엔 billing·expense_requests만
--    있어서 `auth_menu_access('staff')`가 master 빼고 전부 'none'을 돌려줬다 — 그대로 잠갔으면
--    admin·manager가 계약을 못 보는 fail-closed 락아웃이었다). permissions-sql-mirror.test.ts가 드리프트를 잠근다.
--
-- ⚠️ 게이트 함수는 `(select f())`로 감싼다(gotchas #91 — 맨몸이면 행마다 호출).
-- 멱등: drop policy if exists → create policy. 롤백 = 이 정책을 drop하고 0149a의 tenant_read를 되돌리면 된다.

drop policy if exists staff_contracts_tenant_read on public.staff_contracts;
create policy staff_contracts_tenant_read on public.staff_contracts
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_staff_can_read())
  );
