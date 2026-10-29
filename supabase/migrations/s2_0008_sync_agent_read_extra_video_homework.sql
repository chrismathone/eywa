-- s2_0008 — 연동 PC(eywa_sync_agent)가 '따로 낸 영상 숙제'를 읽게 한다 (2026-10-29, 원장 *"따로 낸 영상 숙제도 반 지정된 반으로 귀속"*)
--
-- 왜: 반미정 영상의 반을 숙제로 정하는 워커 판정(`scripts/_classnote/video-teacher-route.mjs` loadHomeworkClassIds)이
--     보고서 영상 숙제(lesson_reports — 이미 읽을 수 있다)에 **따로 낸 영상 숙제**(video_homework_extra_issues)를 합친다.
--     이 표는 서버 전용이라(시즌1 · authenticated·anon 막힘) 연동 PC 역할에 읽기 권한·정책이 없다 — 이대로면 AywaSync 1.0.9의
--     그 질의가 권한 오류로 실패한다.
-- 무엇: 자기 지점 줄 **읽기만**(s2_0006·0390a와 같은 모양 · 쓰기 권한 없음). 앱 사용자 권한은 그대로(서버 전용 유지).
-- 적용 순서: AywaSync 1.0.9 게시 **전에**. 옛 워커(1.0.8)는 이 표를 읽지 않아 영향이 없다.
-- 되돌리기 = scripts/_oneoff/revert-s2_0008-sync-agent-read-extra-video-homework.sql

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent') then
    execute 'grant select on public.video_homework_extra_issues to eywa_sync_agent';
    execute 'drop policy if exists sync_agent_allow on public.video_homework_extra_issues';
    execute $p$create policy sync_agent_allow on public.video_homework_extra_issues for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
    execute 'drop policy if exists sync_agent_tenant_boundary on public.video_homework_extra_issues';
    execute $p$create policy sync_agent_tenant_boundary on public.video_homework_extra_issues as restrictive for select to eywa_sync_agent
      using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid)$p$;
  else
    raise notice 's2_0008: eywa_sync_agent 역할이 없어 건너뜀';
  end if;
end $$;
