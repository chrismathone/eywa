-- s2_0010 되돌리기 — 스냅샷을 만들 때 만료분을 지우지 않는다(종전).
do $$
declare
  definition text;
  prune text := 'delete from tm_sync_private.snapshots where binding_id=p_binding_id and expires_at < ts - interval ''1 hour''; ';
begin
  select pg_get_functiondef('public.tm_sync_create_snapshot(uuid)'::regprocedure) into definition;
  if position(prune in definition) = 0 then raise exception '되돌릴 줄이 없습니다'; end if;
  execute replace(definition, prune, '');
end $$;
