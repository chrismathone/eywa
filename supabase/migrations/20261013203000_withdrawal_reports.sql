-- Laboratory withdrawal reports: immutable approval target, two distinct reviewers,
-- service-only transactions. No student changes before both approvals.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table public.withdrawal_reports (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete restrict,
 requested_by uuid not null references public.users(id) on delete restrict,
 teacher_id uuid not null references public.users(id) on delete restrict,
 manager_id uuid not null references public.users(id) on delete restrict,
 director_id uuid not null references public.users(id) on delete restrict,
 exit_kind text not null check(exit_kind in ('withdrawal','subject_end')),
 subjects text[] not null check(cardinality(subjects)>0), effective_date date not null,
 request_note text not null default '' check(char_length(request_note)<=1000),
 snapshot jsonb not null, body jsonb not null default '{}',
 status text not null default 'requested' check(status in ('requested','revision','manager_pending','director_pending','scheduled','completed','blocked','canceled')),
 revision integer not null default 1,
 manager_approved_at timestamptz, director_approved_at timestamptz, applied_at timestamptz,
 last_comment text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(teacher_id<>manager_id and teacher_id<>director_id and manager_id<>director_id),
 check(octet_length(snapshot::text)<=262144 and octet_length(body::text)<=131072)
);
create unique index withdrawal_reports_one_pending on public.withdrawal_reports(tenant_id,student_id)
 where status not in ('completed','canceled');
create index withdrawal_reports_tenant_created on public.withdrawal_reports(tenant_id,created_at desc);
create index withdrawal_reports_due on public.withdrawal_reports(effective_date) where status='scheduled';
create table public.withdrawal_report_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id) on delete cascade,
 report_id uuid not null references public.withdrawal_reports(id) on delete cascade,
 actor_id uuid references public.users(id) on delete restrict,
 action text not null, from_status text, to_status text not null,
 body jsonb, comment text, created_at timestamptz not null default now()
);
create index withdrawal_report_events_report on public.withdrawal_report_events(tenant_id,report_id,created_at);
alter table public.withdrawal_reports enable row level security;
alter table public.withdrawal_report_events enable row level security;
revoke all on public.withdrawal_reports,public.withdrawal_report_events from public,anon,authenticated;
grant select,insert,update on public.withdrawal_reports to service_role;
grant select,insert on public.withdrawal_report_events to service_role;

create function public.withdrawal_report_snapshot(p_tenant uuid,p_student uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('name',s.name,'school',s.school,'grade',s.grade,'enrolledAt',s.enrolled_at,
  'status',s.status,'withdrawnAt',s.withdrawn_at,'courses',coalesce((
   select jsonb_agg(jsonb_build_object('id',e.id,'classId',e.class_id,'className',c.class_name,
    'subject',c.subject,'teacherId',c.teacher_id,'teacherName',u.display_name,'startDate',e.start_date,
    'endDate',e.end_date,'onHold',e.on_hold) order by e.id)
   from public.enrollments e join public.classes c on c.id=e.class_id and c.tenant_id=p_tenant
   left join public.users u on u.id=c.teacher_id and u.tenant_id=p_tenant
   where e.tenant_id=p_tenant and e.student_id=p_student and
    (e.end_date is null or (e.end_date >= (now() at time zone 'Asia/Seoul')::date and not e.is_transferred))
  ),'[]'::jsonb)) from public.students s where s.id=p_student and s.tenant_id=p_tenant
$$;
revoke all on function public.withdrawal_report_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.withdrawal_report_snapshot(uuid,uuid) to service_role;

create function public.transition_withdrawal_report(p_tenant uuid,p_actor uuid,p_report uuid,p_action text,p_payload jsonb default '{}')
returns public.withdrawal_reports language plpgsql security invoker set search_path=public as $$
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
  if not exists(select 1 from public.users where id=(p_payload->>'managerId')::uuid and tenant_id=p_tenant and status='active' and system_role::text in ('manager','admin','master')) then raise exception '승인할 관리자를 지정해 주세요.'; end if;
  if not exists(select 1 from public.users where id=(p_payload->>'directorId')::uuid and tenant_id=p_tenant and status='active' and system_role::text='master') then raise exception '승인할 원장을 지정해 주세요.'; end if;
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
   if coalesce(p_payload->'body'->>'reason','') not in ('graduated','relocation','illness','competitor','financial','schedule','dissatisfaction','advised','other') or
    coalesce(p_payload->'body'->>'arrears','') not in ('unknown','yes','no') then raise exception '퇴원사유와 미납 여부를 확인해 주세요.'; end if;
   if p_action='submit' and (char_length(btrim(p_payload->'body'->>'detail'))<200 or
    btrim(p_payload->'body'->>'studentConsultation')='' or btrim(p_payload->'body'->>'parentConsultation')='' or btrim(p_payload->'body'->>'teacherOpinion')='') then raise exception '상세사유 200자 이상과 상담 결과·담임 의견을 작성해 주세요.'; end if;
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
   if (p_actor not in (r.requested_by,r.director_id) and actor.system_role::text<>'master') or r.status in ('completed','canceled') then raise exception '이 요청을 취소할 수 없습니다.'; end if;
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
   update public.enrollments set end_date=greatest(start_date,r.effective_date),withdrawal_reason=r.body->>'reason',is_transferred=false
    where tenant_id=p_tenant and student_id=r.student_id and id=any(targets);
   get diagnostics target_count=row_count;
   if target_count<>cardinality(targets) then raise exception '수강 정보가 변경되었습니다. 다시 확인해 주세요.'; end if;
   if r.exit_kind='withdrawal' then
    update public.students set status='withdrawn',withdrawn_at=r.effective_date,
     withdrawal_metadata=jsonb_build_object('reason',r.body->>'reason','memo',r.body->>'detail','reportId',r.id,
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
$$;
revoke all on function public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb) to service_role;
insert into public.lab_menu_assignments(menu_key) values('withdrawal_reports') on conflict do nothing;
commit;
