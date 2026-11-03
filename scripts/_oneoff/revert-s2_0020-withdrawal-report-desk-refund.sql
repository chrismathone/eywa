-- s2_0020 되돌리기 — 퇴원보고서 원장 승인 없앰·관리자 승인 생략·데스크 환불 단계·반 이름 무시 대조를 2026-11-03 운영 정의로 되돌린다.
-- 🔴 앱을 먼저 되돌린다(새 앱은 연결 함수·release를 부른다 — 함수가 없으면 환불 연결·환불 뒤 처리가 실패한다).
-- 멈추는 경우: 관리자 0명 묶음이 진행 중(옛 함수는 승인자 없는 묶음을 끝내지 못한다) · 데스크 환불 대기 묶음이 진행 중(옛 함수는 환불을 기다리지 않는다).
--   먼저 그 묶음을 마무리하거나 취소한다.
-- 남기는 것: 연결 표 withdrawal_report_refunds(기록 — 다시 적용하면 그대로 쓴다) · 이미 관리자 0명으로 끝난 묶음(옛 CHECK는 NOT VALID로 새 행만 막는다)
--   · manager_id가 빈 보고서가 있으면 NOT NULL을 되돌리지 않는다.
-- 본문 = 2026-11-03 운영 pg_get_functiondef 그대로(s2_0020 머리 지문과 같은 정의).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists(select 1 from public.withdrawal_report_groups where status not in ('completed','canceled') and cardinality(manager_ids) = 0) then
    raise exception '관리자 0명 묶음이 진행 중이라 되돌릴 수 없습니다(먼저 마무리하거나 취소)';
  end if;
  if exists(select 1 from public.withdrawal_report_groups g where g.status in ('pending','scheduled') and public.withdrawal_report_refund_pending(g.id)) then
    raise exception '데스크 환불 대기 묶음이 진행 중이라 되돌릴 수 없습니다(먼저 환불을 끝내거나 요청을 취소)';
  end if;
end $$;

-- check_withdrawal_report_submission
CREATE OR REPLACE FUNCTION public.check_withdrawal_report_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 if (new.status='manager_pending' and old.status in ('requested','revision')) or
  (new.group_id is not null and new.status in ('manager_pending','director_pending','approved') and (new.manager_decisions is distinct from old.manager_decisions or new.director_decisions is distinct from old.director_decisions)) then
  perform 1 from public.students where id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.enrollments where student_id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=new.student_id and e.tenant_id=new.tenant_id for share of c;
  if (case when new.exit_kind='withdrawal' then public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot else public.withdrawal_report_scope(public.withdrawal_report_snapshot(new.tenant_id,new.student_id),coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects)) is distinct from public.withdrawal_report_scope(new.snapshot,coalesce((select g.subjects from public.withdrawal_report_groups g where g.id=new.group_id and g.tenant_id=new.tenant_id),new.subjects)) end) then raise exception '요청 이후 학생·수강·담당 강사가 변경되었습니다. 관리자에게 요청을 다시 작성해 달라고 알려 주세요.'; end if;
 end if;
 return new;
end $function$;

-- request_withdrawal_report_group
CREATE OR REPLACE FUNCTION public.request_withdrawal_report_group(p_tenant uuid, p_actor uuid, p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s public.students; actor public.users; snap jsonb; chosen text[]; teachers uuid[]; managers uuid[]; directors uuid[];
 gid uuid; rid uuid; teacher uuid; recipient uuid; subjects_for_teacher text[]; d date; kind text; scope_row jsonb; targets uuid[]; teacher_targets uuid[];
begin
 select * into actor from public.users where id=p_actor and tenant_id=p_tenant and status='active';
 if actor.id is null or actor.system_role::text not in ('master','admin','manager') then raise exception '관리자가 작성 요청을 할 수 있습니다.'; end if;
 select * into s from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
 if s.id is null or s.status::text not in ('enrolled','on_hold') or s.withdrawn_at is not null then raise exception '재원·휴원 학생만 요청할 수 있습니다. 기존 퇴원 예약을 확인해 주세요.'; end if;
 perform 1 from public.enrollments where tenant_id=p_tenant and student_id=s.id for update;
 perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=s.id and e.tenant_id=p_tenant for share of c;
 if exists(select 1 from public.withdrawal_reports where tenant_id=p_tenant and student_id=s.id and group_id is null and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
 snap:=public.withdrawal_report_snapshot(p_tenant,s.id);
 if p_payload ? 'enrollmentIds' then
  if jsonb_typeof(p_payload->'enrollmentIds') is distinct from 'array' then raise exception '종료할 반을 선택해 주세요.'; end if;
  select array_agg(distinct v::uuid order by v::uuid) into targets from jsonb_array_elements_text(p_payload->'enrollmentIds') x(v);
  if coalesce(cardinality(targets),0) not between 1 and 100 or exists(select 1 from unnest(targets) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=x)) then raise exception '현재 학생이 수강 중인 반을 선택해 주세요.'; end if;
  select array_agg(distinct e->>'subject' order by e->>'subject') into chosen from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=any(targets);
 else
  -- 배포 전에 열린 폼은 기존의 명시된 과목 범위를 유지한다.
  select array_agg(distinct v order by v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);
  select array_agg((e->>'id')::uuid order by e->>'id') into targets from jsonb_array_elements(snap->'courses') e where e->>'subject'=any(chosen);
 end if;
 if exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=s.id and e.id=any(targets) and (not c.is_active or c.closed_at is not null)) then raise exception '종강되었거나 운영하지 않는 반은 선택할 수 없습니다. 반 목록을 새로고침해 주세요.'; end if; if exists(select 1 from public.withdrawal_report_groups g2 where g2.tenant_id=p_tenant and g2.student_id=s.id and g2.status not in ('completed','canceled') and (g2.exit_kind='withdrawal' or g2.subjects && chosen or cardinality(chosen)=0)) then raise exception '같은 과목의 퇴원보고서가 진행 중입니다. 그 보고서를 먼저 마무리해 주세요.'; end if;
 select array_agg(distinct v::uuid order by v::uuid) into teachers from jsonb_array_elements_text(p_payload->'teacherIds') x(v);
 select array_agg(distinct v::uuid order by v::uuid) into managers from jsonb_array_elements_text(p_payload->'managerIds') x(v);
 select coalesce(array_agg(distinct v::uuid order by v::uuid),'{}') into directors from jsonb_array_elements_text(p_payload->'directorIds') x(v);
 if coalesce(cardinality(chosen),0)=0 or coalesce(cardinality(teachers),0) not between 1 and 20 or coalesce(cardinality(managers),0) not between 1 and 20 or cardinality(directors)>20 then raise exception '대상 과목·작성 강사·승인 관리자를 선택해 주세요.'; end if;
 if teachers && managers or teachers && directors or managers && directors then raise exception '작성자·관리자·원장을 서로 다르게 지정해 주세요.'; end if;
 if exists(select 1 from unnest(chosen) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=x)) then raise exception '선택 과목의 수강을 찾을 수 없습니다.'; end if;
 if actor.system_role::text<>'master' and not coalesce(public.is_super_admin(actor.id),false) then
  select x into scope_row from public.tenant_settings ts,lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x where ts.tenant_id=p_tenant and x->>'userId'=actor.id::text limit 1;
  if scope_row is not null and exists(select 1 from unnest(chosen) x where not coalesce(scope_row->'subjects','[]') ? x) then raise exception '담당 과목의 보고서만 요청할 수 있습니다.'; end if;
 end if;
 if exists(select 1 from unnest(teachers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')) or not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=x::text and (e->>'id')::uuid=any(targets))) then raise exception '선택한 수강의 담당 강사를 지정해 주세요.'; end if;
 -- 종료 대상은 선택한 모든 반, 작성자는 그중 지정한 강사만이다.
 if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master') and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;
 if exists(select 1 from unnest(directors) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 원장을 선택해 주세요.'; end if;
 d:=(p_payload->>'effectiveDate')::date;
 if d is null or d<coalesce(s.enrolled_at,d) or d>(now() at time zone 'Asia/Seoul')::date+365 then raise exception '종료일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
 kind:=case when exists(select 1 from jsonb_array_elements(snap->'courses') e where not (e->>'id')::uuid=any(targets) and exists(select 1 from public.classes c where c.id=(e->>'classId')::uuid and c.tenant_id=p_tenant and c.is_active and c.closed_at is null)) then 'subject_end' else 'withdrawal' end;
 insert into public.withdrawal_report_groups(tenant_id,student_id,requested_by,teacher_ids,manager_ids,director_ids,subjects,effective_date,exit_kind,snapshot,enrollment_ids)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap,targets) returning id into gid;
 foreach teacher in array teachers loop
  select array_agg(distinct e->>'subject'),array_agg((e->>'id')::uuid order by e->>'id') into subjects_for_teacher,teacher_targets from jsonb_array_elements(snap->'courses') e where (cardinality(teachers)=1 or e->>'teacherId'=teacher::text) and (e->>'id')::uuid=any(targets);
  insert into public.withdrawal_reports(tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,group_id,group_leader,subjects,effective_date,exit_kind,request_note,snapshot,enrollment_ids)
   values(p_tenant,s.id,p_actor,teacher,managers[1],directors[1],managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap,teacher_targets) returning id into rid;
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,to_status) values(p_tenant,rid,p_actor,'request','requested');
  if teacher<>p_actor then insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,teacher,'approval_requested','퇴원보고서 작성 요청',s.name||' · '||d::text,'/withdrawal-reports/'||rid::text,p_actor); end if;
 end loop;
 return gid;
end $function$;

-- transition_withdrawal_report
CREATE OR REPLACE FUNCTION public.transition_withdrawal_report(p_tenant uuid, p_actor uuid, p_report uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS withdrawal_reports
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','grades','motivation','method','career','peers','advised','other') or coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
  if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<100 or btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 100자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
  r.body:=p_payload->'body'; r.manager_decisions:='{}'; r.director_decisions:='{}'; r.manager_approved_at:=null; r.director_approved_at:=null; r.last_comment:=null;
  if p_action='submit' then r.status:='manager_pending'; recipients:=g.manager_ids; headline:=case when cardinality(g.director_ids)=0 and not exists(select 1 from unnest(g.manager_ids) x where not exists(select 1 from public.users u where u.id=x and u.tenant_id=p_tenant and u.system_role::text='master')) then '퇴원보고서 원장 승인 요청' else '퇴원보고서 관리자 승인 요청' end; end if;
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
  if ((p_actor is distinct from g.requested_by) and not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status='active' and u.system_role::text='master')) or g.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
  g.status:='canceled'; headline:='퇴원보고서 요청 취소';
 elsif p_action='apply' then
  if (p_actor is not null and not (r.direct and p_actor=g.requested_by)) or g.status<>'scheduled' or g.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
 end if;
 update public.withdrawal_reports set body=r.body,status=r.status,manager_decisions=r.manager_decisions,director_decisions=r.director_decisions,
  manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,last_comment=r.last_comment,revision=revision+1,updated_at=now() where id=r.id;
 if (r.status='approved' and p_action='approve' and not exists(select 1 from public.withdrawal_reports where group_id=g.id and status<>'approved')) or p_action='apply' then
  perform 1 from public.students where id=g.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=g.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=g.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,g.student_id);
  valid:=(case when g.exit_kind='withdrawal' then snap is not distinct from g.snapshot else public.withdrawal_report_scope(snap,g.subjects) is not distinct from public.withdrawal_report_scope(g.snapshot,g.subjects) end)
   and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(g.enrollment_ids) and (not c.is_active or c.closed_at is not null))
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
   targets:=g.enrollment_ids;
   if targets is null then raise exception '종료할 반을 확인하지 못했습니다. 요청 내용을 다시 확인해 주세요.'; end if;
   if coalesce(cardinality(targets),0)=0 and not (r.direct and g.exit_kind='withdrawal') then raise exception '종료할 수강을 찾을 수 없습니다.'; end if;
   update public.enrollments e set end_date=greatest(e.start_date,g.effective_date),is_transferred=false,
    withdrawal_reason=(select q.body->>'reason' from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_detail=(select nullif(q.body->>'reasonDetail','') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1),
    withdrawal_memo=(select nullif(btrim(q.body->>'detail'),'') from public.withdrawal_reports q join public.classes c on c.id=e.class_id where q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1)
    where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(targets);
   get diagnostics affected=row_count;
   if affected<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if g.exit_kind<>'withdrawal' and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant where e.tenant_id=p_tenant and e.student_id=g.student_id and not e.id=any(coalesce(targets,'{}'::uuid[])) and c.is_active and c.closed_at is null and (e.end_date is null or e.end_date>greatest(g.effective_date,today))) then g.exit_kind:='withdrawal'; update public.withdrawal_report_groups set exit_kind='withdrawal' where id=g.id; update public.withdrawal_reports set exit_kind='withdrawal' where group_id=g.id; end if; if g.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=g.effective_date,
     withdrawal_metadata=(select jsonb_build_object('reason',q.body->>'reason','detail',nullif(q.body->>'reasonDetail',''),'memo',q.body->>'detail','reportId',q.id,'reportGroupId',g.id,'reportIds',(select jsonb_agg(id order by id) from public.withdrawal_reports where group_id=g.id),'consultation',jsonb_build_object('adminCalledParent',false,'teacherCalledParent',false,'talkedWithStudent',false)) from public.withdrawal_reports q where q.group_id=g.id and q.group_leader)
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
end $function$;

-- transition_withdrawal_report_v1
CREATE OR REPLACE FUNCTION public.transition_withdrawal_report_v1(p_tenant uuid, p_actor uuid, p_report uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS withdrawal_reports
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 r public.withdrawal_reports; actor public.users; s public.students;
 prior text; snap jsonb; targets uuid[]; chosen text[]; request_id uuid;
 d date; today date:=(now() at time zone 'Asia/Seoul')::date;
 recipient uuid; recipients uuid[]:='{}'; headline text; comment_text text;
 scope_row jsonb; body_field text; target_count integer; end_kind text;
begin
 if p_action not in ('request','save','submit','approve','reject','cancel','apply') then raise exception '지원하지 않는 처리입니다.'; end if;
 if p_action<>'apply' then
  select * into actor from public.users where id=p_actor and tenant_id=p_tenant and status='active';
  if actor.id is null then raise exception '작업 권한을 확인할 수 없습니다.'; end if;
 end if;
 if p_action='request' then
  if actor.system_role::text not in ('master','admin','manager') then raise exception '관리자가 작성 요청을 할 수 있습니다.'; end if;
  select * into s from public.students where id=(p_payload->>'studentId')::uuid and tenant_id=p_tenant for update;
  if s.id is null or s.status::text not in ('enrolled','on_hold') or s.withdrawn_at is not null then raise exception '재원·휴원 학생만 요청할 수 있습니다. 기존 퇴원 예약도 확인해 주세요.'; end if;
  -- Student FOR UPDATE also serializes new enrollment FK checks; lock existing rows and class ownership.
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=s.id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=s.id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,s.id);
  select array_agg(distinct v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);
  if chosen is null or cardinality(chosen)=0 or p_payload->>'exitKind' not in ('withdrawal','subject_end') then raise exception '종료할 과목을 선택해 주세요.'; end if;
  if exists(select 1 from unnest(chosen) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=x)) then raise exception '선택한 과목의 수강을 찾을 수 없습니다.'; end if;
  if p_payload->>'exitKind'='withdrawal' and exists(select 1 from jsonb_array_elements(snap->'courses') e where not e->>'subject'=any(chosen)) then raise exception '전체 퇴원은 모든 수강 과목을 포함해야 합니다.'; end if;
  -- Subject scope is checked again in the app; personal staff scopes remain a DB defence too.
  if actor.system_role::text<>'master' and not public.is_super_admin(actor.id) then
   select x into scope_row from public.tenant_settings ts, lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x
    where ts.tenant_id=p_tenant and x->>'userId'=actor.id::text limit 1;
   if scope_row is not null and exists(select 1 from unnest(chosen) x where not coalesce(scope_row->'subjects','[]'::jsonb) ? x) then raise exception '담당 과목의 보고서만 요청할 수 있습니다.'; end if;
  end if;
  if not exists(select 1 from public.users where id=(p_payload->>'teacherId')::uuid and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','manager','admin','master')) or
   not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=p_payload->>'teacherId' and e->>'subject'=any(chosen)) then raise exception '해당 과목의 담당 강사를 지정해 주세요.'; end if;
  if not exists(select 1 from public.users where id=(p_payload->>'managerId')::uuid and tenant_id=p_tenant and status='active' and system_role::text in ('manager','admin','master') and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 관리자를 지정해 주세요.'; end if;
  if not exists(select 1 from public.users where id=(p_payload->>'directorId')::uuid and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false)) then raise exception '승인할 원장을 지정해 주세요.'; end if;
  d:=(p_payload->>'effectiveDate')::date;
  if d is null or d<coalesce(s.enrolled_at,d) or d>today+365 then raise exception '퇴원일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
  insert into public.withdrawal_reports(tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot)
   values(p_tenant,s.id,p_actor,(p_payload->>'teacherId')::uuid,(p_payload->>'managerId')::uuid,(p_payload->>'directorId')::uuid,p_payload->>'exitKind',chosen,d,coalesce(p_payload->>'note',''),snap) returning * into r;
  recipients:=array[r.teacher_id]; headline:='퇴원보고서 작성 요청';
 else
  select * into r from public.withdrawal_reports where id=p_report and tenant_id=p_tenant for update;
  if r.id is null then raise exception '보고서를 찾을 수 없습니다.'; end if;
  prior:=r.status;
  if p_action<>'apply' and coalesce((p_payload->>'revision')::integer,0)<>r.revision then raise exception '보고서가 변경되었습니다. 새로고침 후 다시 진행해 주세요.'; end if;
  if p_action in ('save','submit') then
   if r.teacher_id<>p_actor or r.status not in ('requested','revision') then raise exception '작성 요청을 받은 강사만 작성할 수 있습니다.'; end if;
   if jsonb_typeof(p_payload->'body') is distinct from 'object' then raise exception '보고서 본문을 확인해 주세요.'; end if;
   for body_field in select unnest(array['detail','studentConsultation','parentConsultation','teacherOpinion','attendance','tuition','arrearsNote']) loop
    if jsonb_typeof(p_payload->'body'->body_field) is distinct from 'string' or char_length(p_payload->'body'->>body_field)>5000 then raise exception '보고서 항목을 확인해 주세요.'; end if;
   end loop;
   if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','grades','motivation','method','career','peers','advised','other') or
    coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
   if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<100 or
    btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 100자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
   r.body:=p_payload->'body'; r.manager_approved_at:=null; r.director_approved_at:=null;
   if p_action='submit' then r.status:='manager_pending'; recipients:=array[r.manager_id]; headline:='퇴원보고서 관리자 승인 요청'; end if;
  elsif p_action in ('approve','reject') then
   if not ((r.status='manager_pending' and r.manager_id=p_actor and actor.system_role::text in ('admin','manager','master')) or
    (r.status='director_pending' and r.director_id=p_actor and actor.system_role::text='master')) then raise exception '지정된 승인자의 순서가 아닙니다.'; end if;
   if p_action='reject' then
    comment_text:=btrim(coalesce(p_payload->>'comment',''));
    if char_length(comment_text) not between 1 and 1000 then raise exception '반려 사유를 1~1,000자로 작성해 주세요.'; end if;
    r.status:='revision'; r.last_comment:=comment_text; r.manager_approved_at:=null; r.director_approved_at:=null;
    recipients:=array[r.teacher_id,r.requested_by]; headline:='퇴원보고서 수정 요청';
   elsif r.status='manager_pending' then
    r.manager_approved_at:=now(); r.status:='director_pending'; recipients:=array[r.director_id]; headline:='퇴원보고서 원장 승인 요청';
   else
    r.director_approved_at:=now(); r.status:='scheduled'; recipients:=array[r.requested_by,r.teacher_id,r.manager_id]; headline:='퇴원보고서 승인 완료';
   end if;
  elsif p_action='cancel' then
   if ((p_actor is distinct from r.requested_by) and not exists(select 1 from public.users u where u.tenant_id=p_tenant and u.id=p_actor and u.status='active' and u.system_role::text='master')) or r.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
   r.status:='canceled'; recipients:=array[r.teacher_id,r.manager_id,r.director_id]; headline:='퇴원보고서 요청 취소';
  elsif p_action='apply' then
   if p_actor is not null or r.status<>'scheduled' or r.effective_date>today then raise exception '처리일이 된 승인 보고서만 처리할 수 있습니다.'; end if;
   recipients:=array[r.requested_by,r.teacher_id,r.manager_id,r.director_id]; headline:='퇴원·수강종료 처리 완료';
  end if;
 end if;
 -- Final approval/application compares the approved target inside the same transaction.
 if r.status='scheduled' and (p_action in ('approve','apply')) then
  select * into s from public.students where id=r.student_id and tenant_id=p_tenant for update;
  perform 1 from public.enrollments where tenant_id=p_tenant and student_id=r.student_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=r.student_id and e.tenant_id=p_tenant for share of c;
  snap:=public.withdrawal_report_snapshot(p_tenant,r.student_id);
  if snap is distinct from r.snapshot or r.manager_approved_at is null or r.director_approved_at is null or
   not exists(select 1 from public.users where id=r.manager_id and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master')) or
   not exists(select 1 from public.users where id=r.director_id and tenant_id=p_tenant and status='active' and system_role::text='master') then
   if p_action<>'apply' then raise exception '요청 이후 학생·수강·승인자 정보가 변경되었습니다. 요청을 취소한 뒤 다시 작성해 주세요.'; end if;
   r.status:='blocked'; r.last_comment:='승인 이후 학생·수강·승인자 정보가 변경되어 자동 처리를 멈췄습니다. 요청을 취소한 뒤 다시 작성해 주세요.'; headline:='퇴원보고서 재검토 필요';
  elsif r.effective_date<=today then
   select array_agg((e->>'id')::uuid) into targets from jsonb_array_elements(r.snapshot->'courses') e where e->>'subject'=any(r.subjects);
   if targets is null then raise exception '종료할 수강을 찾을 수 없습니다.'; end if;
   update public.enrollments set end_date=greatest(start_date,r.effective_date),withdrawal_reason=r.body->>'reason',withdrawal_detail=nullif(r.body->>'reasonDetail',''),withdrawal_memo=nullif(btrim(r.body->>'detail'),''),is_transferred=false
    where tenant_id=p_tenant and student_id=r.student_id and id=any(targets);
   get diagnostics target_count=row_count;
   if target_count<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if r.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=r.effective_date,
     withdrawal_metadata=jsonb_build_object('reason',r.body->>'reason','detail',nullif(r.body->>'reasonDetail',''),'memo',r.body->>'detail','reportId',r.id,
      'consultation',jsonb_build_object('adminCalledParent',false,'teacherCalledParent',false,'talkedWithStudent',false))
     where id=r.student_id and tenant_id=p_tenant;
   end if;
   r.status:='completed'; r.applied_at:=now(); headline:='퇴원·수강종료 처리 완료';
  end if;
 end if;
 if p_action<>'request' then
  r.revision:=r.revision+1; r.updated_at:=now();
  update public.withdrawal_reports set body=r.body,status=r.status,revision=r.revision,
   manager_approved_at=r.manager_approved_at,director_approved_at=r.director_approved_at,
   applied_at=r.applied_at,last_comment=r.last_comment,updated_at=r.updated_at where id=r.id;
 end if;
 insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,from_status,to_status,body,comment)
 values(p_tenant,r.id,p_actor,p_action,prior,r.status,case when p_action in ('submit','reject','approve','apply') then r.body else null end,comment_text);
 -- Persist web notifications atomically with state changes. Existing delivery triggers handle the inbox.
 for recipient in select distinct x from unnest(recipients) x where x<>coalesce(p_actor,'00000000-0000-0000-0000-000000000000') loop
  insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id)
   values(p_tenant,recipient,case when r.status in ('requested','manager_pending','director_pending','revision') then 'approval_requested' else 'approval_decided' end,
    headline,r.snapshot->>'name'||' · '||r.effective_date::text,'/withdrawal-reports/'||r.id::text,p_actor);
 end loop;
 return r;
end;
$function$;

drop function if exists public.release_withdrawal_report_refunds(uuid, uuid, uuid);
drop function if exists public.attach_withdrawal_report_refund(uuid, uuid, uuid, uuid, uuid);
drop function if exists public.withdrawal_report_refund_pending(uuid);
drop function if exists public.withdrawal_report_compare_key(jsonb, text[]);

alter table public.withdrawal_report_groups drop constraint if exists withdrawal_report_groups_manager_ids_check;
alter table public.withdrawal_report_groups add constraint withdrawal_report_groups_manager_ids_check check (cardinality(manager_ids) > 0) not valid;
do $$
begin
  if not exists(select 1 from public.withdrawal_reports where manager_id is null) then
    alter table public.withdrawal_reports alter column manager_id set not null;
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
