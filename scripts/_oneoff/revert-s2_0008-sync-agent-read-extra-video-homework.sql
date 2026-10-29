-- s2_0008 되돌리기 — 연동 PC의 '따로 낸 영상 숙제' 읽기 권한·정책을 거둔다.
-- 🔴 AywaSync 1.0.9 이상이 도는 동안 되돌리면 반미정 숙제 판정 질의가 권한 오류로 실패한다(영상은 반미정으로 남는다).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent') then
    execute 'drop policy if exists sync_agent_allow on public.video_homework_extra_issues';
    execute 'drop policy if exists sync_agent_tenant_boundary on public.video_homework_extra_issues';
    execute 'revoke select on public.video_homework_extra_issues from eywa_sync_agent';
  end if;
end $$;
