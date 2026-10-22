-- A replacement principal can cancel a stuck request; mandatory approvals remain assigned.
begin;
do $$
declare definition text;
begin
 select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,
  'if p_actor not in (r.requested_by,r.director_id) or r.status in (''completed'',''canceled'') then',
  'if (p_actor not in (r.requested_by,r.director_id) and actor.system_role::text<>''master'') or r.status in (''completed'',''canceled'') then');
 execute definition;
end $$;
commit;
