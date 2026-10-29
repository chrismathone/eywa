-- s2_0012 되돌리기 — 숙제 영상 업로드 실패 알림을 다시 반 담임 + 원장·관리자 전원에게(종전).
do $$
declare
  definition text;
  old text := '(u.system_role in (''master'',''admin'') or u.id=v_teacher)';
  mine text := '(u.id=coalesce((select t.id from public.users t where t.id=v_teacher and t.tenant_id=p_tenant and t.status=''active''),(select t.id from public.users t where t.id::text=v_upload.route->>''teacherId'' and t.tenant_id=p_tenant and t.status=''active'')) or (u.system_role in (''master'',''admin'') and coalesce((select t.id from public.users t where t.id=v_teacher and t.tenant_id=p_tenant and t.status=''active''),(select t.id from public.users t where t.id::text=v_upload.route->>''teacherId'' and t.tenant_id=p_tenant and t.status=''active'')) is null))';
begin
  select pg_get_functiondef('public.record_homework_video_upload_event(uuid,uuid,uuid,jsonb,text)'::regprocedure) into definition;
  if position(mine in definition) = 0 then raise exception '되돌릴 줄이 없습니다'; end if;
  execute replace(definition, mine, old);
end $$;
