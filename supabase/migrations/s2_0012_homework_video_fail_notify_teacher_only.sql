-- s2_0012 — 숙제 영상 업로드 실패 알림: 할 일 담당(반 담임 → 업로드 경로 강사)에게만 · 둘 다 없을 때만 원장·관리자 (2026-10-29)
--
-- 왜: 원장 *"내가 언급된 일 말고는 전부 알림 꺼버려. 내가 언급된 일만 알림 키는게 맞을듯"* · *"내 학생 내 반 이런거 있잖아. 나와 관련있는 알림만."*
--     `record_homework_video_upload_event`(0404a)는 실패를 반 담임 **과** 원장·관리자 전원에게 보냈다(역할 전원 사본).
-- 무엇: 수신자 조건 한 줄만 — 할 일 담당(s2_0004 `video_upload_check`)과 같은 순서: 반 담임(재직) → 업로드 경로의 강사(route.teacherId, 재직)
--     → 둘 다 없으면 원장·관리자. 아무에게도 안 가는 일은 없고, 할 일을 맡은 사람이 알림도 받는다.
--     본문은 운영 함수 그대로(그 줄 1건 확인 뒤 치환 · s2_0010과 같은 방식).
-- 되돌리기 = scripts/_oneoff/revert-s2_0012-homework-video-fail-notify-teacher-only.sql

do $$
declare
  definition text;
  needle text := '(u.system_role in (''master'',''admin'') or u.id=v_teacher)';
  mine text := '(u.id=coalesce((select t.id from public.users t where t.id=v_teacher and t.tenant_id=p_tenant and t.status=''active''),(select t.id from public.users t where t.id::text=v_upload.route->>''teacherId'' and t.tenant_id=p_tenant and t.status=''active'')) or (u.system_role in (''master'',''admin'') and coalesce((select t.id from public.users t where t.id=v_teacher and t.tenant_id=p_tenant and t.status=''active''),(select t.id from public.users t where t.id::text=v_upload.route->>''teacherId'' and t.tenant_id=p_tenant and t.status=''active'')) is null))';
begin
  select pg_get_functiondef('public.record_homework_video_upload_event(uuid,uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if position(mine in definition) > 0 then raise notice 's2_0012: 이미 적용됨'; return; end if;
  if (length(definition) - length(replace(definition, needle, ''))) / length(needle) <> 1 then
    raise exception 's2_0012: record_homework_video_upload_event에서 바꿀 줄이 하나가 아닙니다';
  end if;
  execute replace(definition, needle, mine);
end $$;
