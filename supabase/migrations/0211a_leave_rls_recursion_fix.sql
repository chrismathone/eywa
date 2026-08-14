-- 0211a — 🔴 긴급: 휴가 RLS **무한 재귀**(42P17) 수리. 0210a 적용 직후 /leave가 통째로 500.
--
-- 증상: 배포 직후 휴가관리 창이 "This page couldn't load". 실측(anon 키로 재현):
--   GET /rest/v1/leave_requests  → 500 {"code":"42P17","message":"infinite recursion detected in policy
--   for relation \"leave_requests\""}   (leave_approvals도 동일)
--
-- 🔴 원인: **정책 두 개가 서로의 표를 조회했다.**
--   · `leave_requests_approver_read`  → `exists (select … from leave_approvals …)`
--   · `leave_approvals_visible_read`  → `exists (select … from leave_requests …)`
--   정책 안의 서브쿼리에도 **그 표의 RLS가 다시 걸리기 때문에** A→B→A로 순환하고, Postgres는 이걸
--   행 평가 전에(재작성 단계에서) 잡아 **쿼리 자체를 거부**한다. 그래서 0행이어도, 심지어 자기 것만
--   읽어도 500이다. 표·컬럼·앱 코드는 멀쩡했다.
--
-- ✅ 해법: 교차 조회를 **security definer 함수로 감싼다**. 함수 안에서는 소유자 권한으로 돌아 RLS가
--    다시 걸리지 않으므로 고리가 끊긴다(`auth_tenant_id()`가 쓰는 것과 같은 수법 — 0001a).
--    ⚠️ 함수는 **자기 자신에 대한 사실만** 돌려준다(내가 이 신청서의 결재자인가 / 신청자인가) —
--       남의 데이터를 노출하지 않으므로 RPC로 직접 불려도 무해하다.
--
-- ⚠️ 0210a의 정책을 **대체**한다(같은 이름을 drop 후 재생성). 0210a 파일은 역사 기록으로 남긴다 —
--    새 DB는 0210a → 0211a 순으로 적용되어 결국 이 정의로 수렴한다.
-- 롤백: 이 파일의 정책 4개를 0210a 버전으로 되돌리면 되지만, 그러면 500이 재발한다(되돌리지 말 것).
set local statement_timeout = '60s';

-- ── 고리를 끊는 두 함수 ───────────────────────────────────────────────────────
-- 내가 이 신청서의 **결재자**인가.
create or replace function public.auth_is_leave_approver(p_request uuid) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.leave_approvals a
    where a.request_id = p_request
      and a.approver_id = auth.uid()
      and a.tenant_id = public.auth_tenant_id()
  )
$$;

-- 이 신청서를 낸 사람이 **나**인가.
create or replace function public.auth_is_leave_requester(p_request uuid) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.leave_requests r
    where r.id = p_request
      and r.user_id = auth.uid()
      and r.tenant_id = public.auth_tenant_id()
  )
$$;

revoke all on function public.auth_is_leave_approver(uuid) from public;
revoke all on function public.auth_is_leave_requester(uuid) from public;
grant execute on function public.auth_is_leave_approver(uuid) to authenticated, service_role;
grant execute on function public.auth_is_leave_requester(uuid) to authenticated, service_role;

comment on function public.auth_is_leave_approver(uuid) is
  '휴가 RLS 전용 — 정책 안에서 leave_approvals를 직접 조회하면 상호 재귀(42P17)라 security definer로 감쌌다. 0211a';
comment on function public.auth_is_leave_requester(uuid) is
  '휴가 RLS 전용 — 정책 안에서 leave_requests를 직접 조회하면 상호 재귀(42P17)라 security definer로 감쌌다. 0211a';

-- ── 정책 재작성 ──────────────────────────────────────────────────────────────
-- 본인 신청서(교차 참조 없음 — 그대로 유지, 재실행 안전을 위해 다시 만든다)
drop policy if exists leave_requests_self_read on public.leave_requests;
create policy leave_requests_self_read on public.leave_requests
  for select
  using (tenant_id = public.auth_tenant_id() and user_id = (select auth.uid()));

-- 내가 결재자로 걸린 신청서 — 서브쿼리 → 함수
-- ⚠️ 인자가 **행의 id**라 `(select …)`로 감쌀 수 없다([[#91]]의 InitPlan 대상이 아니다) — 행마다 도는 대신
--    leave_approvals(request_id) 인덱스 한 방이고, 결재함 조회는 이미 id 목록으로 좁혀 들어온다.
drop policy if exists leave_requests_approver_read on public.leave_requests;
create policy leave_requests_approver_read on public.leave_requests
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_is_leave_approver(id));

-- 원장(master) — 학원 전체 휴가 현황(교차 참조 없음, users만 본다)
drop policy if exists leave_requests_master_read on public.leave_requests;
create policy leave_requests_master_read on public.leave_requests
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and (select exists (
      select 1 from public.users u
      where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
    ))
  );

-- 결재란 — 내가 결재자이거나, 내 신청서의 결재선이거나, master
drop policy if exists leave_approvals_visible_read on public.leave_approvals;
create policy leave_approvals_visible_read on public.leave_approvals
  for select
  using (
    tenant_id = public.auth_tenant_id()
    and (
      approver_id = (select auth.uid())
      or public.auth_is_leave_requester(request_id)
      or (select exists (
        select 1 from public.users u
        where u.id = (select auth.uid()) and u.system_role = 'master' and u.tenant_id = public.auth_tenant_id()
      ))
    )
  );

notify pgrst, 'reload schema';
