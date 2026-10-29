-- s2_0009 되돌리기 — 퇴원보고서 요청 취소를 다시 요청자 본인만.
do $$
declare
  definition text;
  director text := 'not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status=''active'' and u.system_role::text=''master'')';
begin
  select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('((p_actor is distinct from g.requested_by) and ' || director || ')' in definition) = 0 then raise exception '되돌릴 줄이 없습니다(묶음)'; end if;
  execute replace(definition, '((p_actor is distinct from g.requested_by) and ' || director || ')', '(p_actor is distinct from g.requested_by)');
  select pg_get_functiondef('public.transition_withdrawal_report_v1(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('((p_actor is distinct from r.requested_by) and ' || director || ')' in definition) = 0 then raise exception '되돌릴 줄이 없습니다(한 건)'; end if;
  execute replace(definition, '((p_actor is distinct from r.requested_by) and ' || director || ')', '(p_actor is distinct from r.requested_by)');
end $$;
