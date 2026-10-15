-- 0366a — 연동 앱(AywaSync)이 메이크에듀 직원 출퇴근을 `staff_attendance_days`(0365a)에 쓰게 한다.
--
-- 원장 2026-10-15 *"https://school.makeedu.co.kr/config/staffAttList.do 에서 확인가능함"* → *"추천으로 진행"*.
-- 연동 PC의 `import-staff-attendance.cjs`가 게이트웨이 거래 안에서 `eywa_sync_agent` 역할로 이 표를 읽고 쓴다.
-- 다른 표와 같은 4문장(20261008101000 모양): RLS 켜기 · 권한 · 그 지점 줄만(허용) · 그 지점 줄 + 외래키 대상도 같은 지점(제한).
-- 0365a가 준 service_role 권한과 다른 역할의 권한은 그대로다(사람·화면은 계속 이 표를 직접 읽지 못한다).
-- + `sync_agent_staff_attendance_ready(지점)` — 강사평가를 쓰는 지점인가(직원 포트폴리오를 최근 3일 안에 집계했나 — 밤 집계는 켜진 지점만 돈다)만 참/거짓으로 답한다. 연동 앱(sync-all ·
--   가져오기)은 이게 거짓이면 출퇴근 화면을 열지도 않는다(기능 스위치가 꺼진 지점엔 워커 흔적도 없게). 연동 앱 역할로 부르면 제 지점만 답한다.
-- 멱등 · 앱은 이 SQL 전에도 돈다(연동 앱의 출퇴근 단계만 권한 오류로 실패하고 나머지 동기화는 계속된다).
do $mig$
begin
  if to_regclass('public.staff_attendance_days') is null or to_regclass('public.teacher_portfolio_months') is null
    or not exists (select from pg_roles where rolname = 'eywa_sync_agent') then
    raise notice '0366a: staff_attendance_days · teacher_portfolio_months 또는 eywa_sync_agent 역할이 없어 건너뜀';
    return;
  end if;
  execute $f$create or replace function public.sync_agent_staff_attendance_ready(p_tenant uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $body$
      select exists (
        select 1 from public.teacher_portfolio_months m
        where m.tenant_id = p_tenant
          and m.computed_at > now() - interval '3 days'
          and (nullif(current_setting('eywa.agent_tenant', true), '') is null
            or nullif(current_setting('eywa.agent_tenant', true), '')::uuid = p_tenant)
      )
    $body$$f$;
  execute 'revoke all on function public.sync_agent_staff_attendance_ready(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.sync_agent_staff_attendance_ready(uuid) to eywa_sync_agent, service_role';
  execute 'alter table public.staff_attendance_days enable row level security';
  execute 'grant select, insert, update, delete on public.staff_attendance_days to eywa_sync_agent';
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'staff_attendance_days' and policyname = 'sync_agent_allow') then
    execute $p$create policy sync_agent_allow on public.staff_attendance_days for all to eywa_sync_agent
      using (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid)$p$;
  end if;
  if not exists (select from pg_policies where schemaname = 'public' and tablename = 'staff_attendance_days' and policyname = 'sync_agent_tenant_boundary') then
    execute $p$create policy sync_agent_tenant_boundary on public.staff_attendance_days as restrictive for all to eywa_sync_agent
      using (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid
        and public.sync_agent_foreign_keys('public.staff_attendance_days'::regclass, to_jsonb(staff_attendance_days)))$p$;
  end if;
end
$mig$;
notify pgrst, 'reload schema';
