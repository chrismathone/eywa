-- AywaSync 1.0.21: makeedu 좌석 초과 알림이 자기 지점의 좌석 한도만 읽는다.
-- 원장 2026-11-12: 다음 AywaSync 판에 옛 워커 스위치·좌석 알림·읽기 권한을 함께 반영.
-- 읽기 전용 네 칸만 허용한다. 기존 사용자 정책은 바꾸지 않으며 다른 기능 라이선스는 보이지 않는다.
-- 되돌리기: 아래 두 정책을 내리고 네 칸의 select 권한을 회수한다(앱은 알림 실패만 기록).
begin;
grant select (tenant_id, feature, is_active, max_seats) on public.tenant_licenses to eywa_sync_agent;
drop policy if exists sync_agent_seat_license on public.tenant_licenses;
create policy sync_agent_seat_license on public.tenant_licenses for select to eywa_sync_agent
  using (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid and feature = 'student_seats');
drop policy if exists sync_agent_license_boundary on public.tenant_licenses;
create policy sync_agent_license_boundary on public.tenant_licenses as restrictive for select to eywa_sync_agent
  using (tenant_id = nullif(current_setting('eywa.agent_tenant', true), '')::uuid and feature = 'student_seats');
commit;
