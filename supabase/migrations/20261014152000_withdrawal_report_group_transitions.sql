begin;
set local lock_timeout='5s';
alter function public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb) rename to transition_withdrawal_report_v1;
-- Group lock precedes all child locks. Only the last required approval can apply the shared target.
create function public.transition_withdrawal_report(p_tenant uuid,p_actor uuid,p_report uuid,p_action text,p_payload jsonb default '{}')
returns public.withdrawal_reports language plpgsql security invoker set search_path=public as $$
declare
 r public.withdrawal_reports; g public.withdrawal_report_groups; actor public.users; snap jsonb;
 gid uuid; prior text; recipient uuid; recipients uuid[]:='{}'; headline text; comment_text text;
 field text; child public.withdrawal_reports; valid boolean; targets uuid[]; affected integer;
 today date:=(now() at time zone 'Asia/Seoul')::date;
begin
 if p_action='request' then
  perform 1 from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
  if exists(select 1 from public.withdrawal_report_groups where tenant_id=p_tenant and student_id=(p_payload->>'studentId')::uuid and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
  return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload);
 end if;
 select group_id into gid from public.withdrawal_reports where tenant_id=p_tenant and id=p_report;
 if gid is null then return public.transition_withdrawal_report_v1(p_tenant,p_actor,p_report,p_action,p_payload); end if;
 select * into g from public.withdrawal_report_groups where tenant_id=p_tenant and id=gid for update;
 select * into r from public.withdrawal_reports where tenant_id=p_tenant and id=p_report for update;
 prior:=r.status;
 if p_action not in ('save','submit','approve','reject','cancel','apply') then raise exception '지원하지 않는 처리입니다.'; end if;
 if p_action<>'apply' then
  select * into actor from public.users where tenant_id=p_tenant and id=p_actor and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
  if coalesce((p_payload->>'revision')::integer,0)<>r.revision then raise exception '보고서가 변경되었습니다. 새로고침 후 다시 진행해 주세요.'; end if;
 end if;
 if p_action in ('save','submit') then
  if r.teacher_id<>p_actor or r.status not in ('requested','revision') or g.status<>'pending' then raise exception '작성 요청을 받은 강사만 작성할 수 있습니다.'; end if;
  if jsonb_typeof(p_payload->'body') is distinct from 'object' then raise exception '보고서 본문을 확인해 주세요.'; end if;
  foreach field in array array['detail','studentConsultation','parentConsultation','teacherOpinion','attendance','tuition','arrearsNote'] loop
   if jsonb_typeof(p_payload->'body'->field) is distinct from 'string' or char_length(p_payload->'body'->>field)>5000 then raise exception '보고서 항목을 확인해 주세요.'; end if;
  end loop;
  if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','advised','other') or coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
  if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<200 or btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 200자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
  r.body:=p_payload->'body'; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null; r.last_comment:=null;
  if p_action='submit' then r.status:='manager_pending'; recipients:=g.manager_ids; headline:='퇴원보고서 관리자 승인 요청'; end if;
 elsif p_action in ('approve','reject') then
  if g.status<>'pending' or not ((r.status='manager_pending' and p_actor=any(g.manager_ids) and not r.manager_decisions ? p_actor::text and actor.system_role::text in ('admin','manager','master')) or (r.status='director_pending' and p_actor=any(g.director_ids) and not r.director_decisions ? p_actor::text and actor.system_role::text='master' and not coalesce(public.is_super_admin(actor.id),false))) then raise exception '지정된 승인자의 순서가 아닙니다.'; end if;
  if p_action='reject' then
   comment_text:=btrim(coalesce(p_payload->>'comment',''));
   if char_length(comment_text) not between 1 and 1000 then raise exception '반려 사유를 1~1,000자로 작성해 주세요.'; end if;
   r.status:='revision'; r.last_comment:=comment_text; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null;
   recipients:=array[r.teacher_id,g.requested_by]||g.manager_ids||g.director_ids; headline:='퇴원보고서 수정 요청';
  elsif r.status='manager_pending' then
   r.manager_decisions:=r.manager_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.manager_ids) x where not r.manager_decisions ? x::text) then
    r.manager_approved_at:=now();
    if cardinality(g.director_ids)=0 then r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]; headline:='퇴원보고서 승인 완료';
    else r.status:='director_pending'; recipients:=g.director_ids; headline:='퇴원보고서 원장 승인 요청'; end if;
   end if;
  else
   r.director_decisions:=r.director_decisions||jsonb_build_object(p_actor::text,now());
   if not exists(select 1 from unnest(g.director_ids) x where not r.director_decisions ? x::text) then r.director_approved_at:=now(); r.status:='approved'; recipients:=array[r.teacher_id,g.requested_by]||g.manager_ids; headline:='퇴원보고서 승인 완료'; end if;
  end if;
 elsif p_action='cancel' then
  if (p_actor<>g.requested_by and not p_actor=any(g.director_ids) and actor.system_role::text<>'master') or g.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
 elsif p_action='apply' then
  if p_actor is not null or g.status<>'scheduled' or g.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
 end if;
 update public.withdrawal_reports set body=r.body,status=r.status,manager_decisions=r.manager_decisions,director_decisions=r.director_decisions,
  manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,last_comment=r.last_comment,revision=revision+1,updated_at=now() where id=r.id;
 if (r.status='approved' and p_action='approve' and not exists(select 1 from public.withdrawal_reports where group_id=g.id and status<>'approved')) or p_action='apply' then
  perform 1 from public.students where id=g.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=g.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=g.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,g.student_id);
  valid:=snap is not distinct from g.snapshot
   and (select count(*) from public.withdrawal_reports where group_id=g.id)=cardinality(g.teacher_ids)
   and not exists(select 1 from public.withdrawal_reports q where q.group_id=g.id and (q.status not in ('approved','scheduled') or exists(select 1 from unnest(g.manager_ids) x where not q.manager_decisions ? x::text) or exists(select 1 from unnest(g.director_ids) x where not q.director_decisions ? x::text)))
   and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')))
   and not exists(select 1 from unnest(g.director_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false)))
   and not exists(select 1 from unnest(g.teacher_ids) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')));
  if not coalesce(valid,false) then
   if p_action<>'apply' then raise exception '요청 이후 학생·수강·승인자 정보가 변경되었습니다. 요청을 취소한 뒤 다시 작성해 주세요.'; end if;
   g.status:='blocked'; headline:='퇴원보고서 재검토 필요';
   comment_text:='승인 이후 학생·수강·승인자 정보가 변경되어 자동 처리를 멈췄습니다. 요청을 취소한 뒤 다시 작성해 주세요.';
  elsif g.effective_date>today then g.status:='scheduled'; headline:='퇴원보고서 전체 승인 완료';
  else
   select array_agg((e->>'id')::uuid) into targets from jsonb_array_elements(g.snapshot->'courses') e where e->>'subject'=any(g.subjects);
   if coalesce(cardinality(targets),0)=0 then raise exception '종료할 수강을 찾을 수 없습니다.'; end if;
   update public.enrollments e set end_date=greatest(e.start_date,g.effective_date),is_transferred=false,
    withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1)
    where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(targets);
   get diagnostics affected=row_count;
   if affected<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if g.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=g.effective_date,
     withdrawal_metadata=(select jsonb_build_object('reason',q.body->>'reason','memo',q.body->>'detail','reportId',q.id,'reportGroupId',g.id,'reportIds',(select jsonb_agg(id order by id) from public.withdrawal_reports where group_id=g.id),'consultation',jsonb_build_object('adminCalledParent',false,'teacherCalledParent',false,'talkedWithStudent',false)) from public.withdrawal_reports q where q.group_id=g.id and q.group_leader)
     where tenant_id=p_tenant and id=g.student_id;
   end if;
   g.status:='completed'; g.applied_at:=now(); headline:='퇴원·수강종료 처리 완료';
  end if;
 end if;
 if g.status in ('scheduled','completed','blocked','canceled') then
  -- Each child keeps a complete audit trail and its own notification link.
  for child in select * from public.withdrawal_reports where group_id=g.id order by id loop
   update public.withdrawal_reports set status=g.status,applied_at=g.applied_at,last_comment=coalesce(comment_text,last_comment),revision=revision+1,updated_at=now() where id=child.id;
   insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,comment) values(p_tenant,child.id,p_actor,p_action,child.status,g.status,comment_text);
   for recipient in select distinct x from unnest(array[g.requested_by,child.teacher_id]||g.manager_ids||g.director_ids) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
    insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_decided',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||child.id::text,p_actor);
   end loop;
  end loop;
  update public.withdrawal_report_groups set status=g.status,applied_at=g.applied_at where id=g.id;
 else
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,body,comment) values(p_tenant,r.id,p_actor,p_action,prior,r.status,case when p_action in ('submit','approve','reject') then r.body end,comment_text);
  for recipient in select distinct x from unnest(recipients) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
   insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,recipient,'approval_requested',headline,g.snapshot->>'name'||' · '||g.effective_date::text,'/withdrawal-reports/'||r.id::text,p_actor);
  end loop;
 end if;
 select * into r from public.withdrawal_reports where id=r.id;
 return r;
end $$;
revoke all on function public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb) to service_role;
commit;
