-- 0253b_audit_logs_super_admin_read.sql (손수 alpha)
-- 0253a의 구멍 메움: **super_admin(SaaS 총괄)이 자기 학원 감사로그를 못 읽고 있었다.**
--
-- 배경: 0253a는 `auth_system_role() in ('master','super_admin')`으로 썼는데,
--   🔴 `system_role` enum에 **`super_admin` 값이 없다**(master·admin·manager·teacher·counselor·
--      accountant·viewer·student 8개뿐). super_admin은 역할이 아니라 **별도 표**(`public.super_admins`)이고
--      판정 함수는 `public.is_super_admin(uid)`다. 즉 0253a의 `'super_admin'` 가지는 **어떤 행도 안 맞는
--      죽은 코드**였고, 실제 총괄(users.system_role = 'admin')은 감사로그가 **에러 없이 0행**이었다.
--   ⚠️ 실측(2026-09-10 적용 직후): super_admin 2명 중 system_role이 master가 아닌 1명 → 읽힌 행 0.
--   이는 결정 로그 *"super_admin은 새로 만드는 어떤 제한 명단·게이트도 자동 통과한다"*(원장 2026-08-13)
--   위반이라 바로잡는다.
--
-- 🔴 **테넌트 격리는 그대로 둔다.** 총괄이라고 남의 학원 로그가 이 화면에 섞이면 안 된다 —
--    여기서 여는 것은 `/owner?tab=audit`(그 학원 안에서 보는 화면)이고, 전 학원을 보는 자리는
--    super-admin 콘솔(별도 라우트 + admin 클라이언트)이다. 축을 섞지 않는다.
-- 🔴 INSERT는 여전히 그대로(0219a `audit_logs_insert_own`) — 누구나 자기 행동은 남겨야 한다.
--
-- 멱등: drop policy if exists → create.
-- 롤백: 이 정책을 drop하고 0253a의 정책을 다시 만든다(단 그러면 총괄이 다시 잠긴다).

drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists audit_logs_select_master on public.audit_logs;

create policy audit_logs_select_master on public.audit_logs
  for select to authenticated
  using (
    tenant_id = public.auth_tenant_id()
    and (
      -- 🔴 `(select ...)`로 감싼다 — 컬럼과 비교되지 않는 게이트 함수를 맨몸으로 쓰면 **행마다** 호출돼
      --    수만 행 스캔이 초 단위로 느려진다([[#91]]). InitPlan으로 접히면 쿼리당 1회다.
      (select public.auth_system_role()) = 'master'
      or (select public.is_super_admin((select auth.uid())))
    )
  );

-- 확인용(적용 뒤):
--   원장(master) 계정   → select count(*) from public.audit_logs;  -- 숫자
--   총괄(super_admin)   → 같은 쿼리가 **0이 아니어야** 한다(0253a에서는 0이었다)
--   강사·뷰어·일반 admin → 0
