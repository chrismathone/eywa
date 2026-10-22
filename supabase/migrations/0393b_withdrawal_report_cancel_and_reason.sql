-- 취소는 요청자만. 보고서의 내부 세부 사유를 실제 퇴원·수강종료에도 보존한다.
begin;
set local lock_timeout = '5s';
do $$
declare
  name text; definition text; old_text text; new_text text; patch text[];
begin
  foreach name in array array['transition_withdrawal_report','transition_withdrawal_report_v1'] loop
    select pg_get_functiondef(('public.'||name||'(uuid,uuid,uuid,text,jsonb)')::regprocedure) into definition;
    foreach patch slice 1 in array (case when name='transition_withdrawal_report' then array[
      array[$q$(p_actor<>g.requested_by and not p_actor=any(g.director_ids) and actor.system_role::text<>'master')$q$,$q$(p_actor is distinct from g.requested_by)$q$],
      array[$q$withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'')$q$,$q$withdrawal_detail=(select nullif(q.body->>'reasonDetail','') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1),
    withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'')$q$],
      array[$q$jsonb_build_object('reason',q.body->>'reason','memo',q.body->>'detail'$q$,$q$jsonb_build_object('reason',q.body->>'reason','detail',nullif(q.body->>'reasonDetail',''),'memo',q.body->>'detail'$q$]
    ] else array[
      array[$q$(p_actor not in (r.requested_by,r.director_id) and actor.system_role::text<>'master')$q$,$q$(p_actor is distinct from r.requested_by)$q$],
      array[$q$withdrawal_memo=nullif(btrim(r.body->>'detail'),'')$q$,$q$withdrawal_detail=nullif(r.body->>'reasonDetail',''),withdrawal_memo=nullif(btrim(r.body->>'detail'),'')$q$],
      array[$q$jsonb_build_object('reason',r.body->>'reason','memo',r.body->>'detail'$q$,$q$jsonb_build_object('reason',r.body->>'reason','detail',nullif(r.body->>'reasonDetail',''),'memo',r.body->>'detail'$q$]
    ] end) loop
      old_text:=patch[1]; new_text:=patch[2];
      if position(new_text in definition)>0 then continue; end if;
      if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then
        raise exception '0393b: expected exactly one replacement in %',name;
      end if;
      definition:=replace(definition,old_text,new_text);
    end loop;
    execute definition;
  end loop;
end $$;
commit;
