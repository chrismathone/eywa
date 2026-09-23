-- 0290a — payroll_records(월별 급여 기록)를 master(원장) 전용 RLS로 잠근다
--
-- 배경(감사 S5, 2026-09-23): 0017a가 이 표에 **지점 격리 정책 하나**(payroll_tenant_isolation)만 걸었다.
-- 역할을 안 보므로 강사·뷰어도 PostgREST 직결로 **남의 급여를 읽고 쓸 수 있었다**([[#92]]와 같은 모양).
-- salary_tiers(0199a)·payslips(0205a)와 같은 규율로 master만 남긴다.
--
-- 🔑 앱은 이 SQL 적용 전·후 모두 동작한다([[#95]] expand/contract):
--    급여 화면·액션(src/features/payroll/server/{queries,actions}.ts)은 앱 게이트
--    (requireAccess("staff") + isPayrollEnabled + canManageStaff + canWriteTenant("staff"))를 통과한 뒤
--    **admin 클라이언트 + 명시 tenant_id 필터**로 읽고 쓴다([[#104]]). 그래서 이 정책이 걸려도
--    게이트를 통과한 admin·manager는 종전처럼 쓰고, 직결 PostgREST만 master로 좁혀진다.
-- ⚠️ 활동 로그 트리거(0084a log_activity)는 security definer라 영향 없다.
-- ⚠️ 게이트는 `(select …)`로 감싼다([[#91]] InitPlan — 행마다 호출 방지).
--
-- 멱등: drop policy if exists → create policy.
-- 롤백: 아래 정책을 지우고 0017a의 payroll_tenant_isolation을 다시 만든다.
set local statement_timeout = '60s';

alter table public.payroll_records enable row level security;

drop policy if exists payroll_tenant_isolation on public.payroll_records;
drop policy if exists payroll_records_master_all on public.payroll_records;
create policy payroll_records_master_all on public.payroll_records
  for all to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

notify pgrst, 'reload schema';
