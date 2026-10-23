-- Additive batch requests: one independently written report per teacher; reviewers are explicit arrays.
begin;
set local lock_timeout='5s';
create table public.withdrawal_report_groups (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 student_id uuid not null references public.students(id) on delete restrict, requested_by uuid not null references public.users(id) on delete restrict,
 teacher_ids uuid[] not null, manager_ids uuid[] not null check(cardinality(manager_ids)>0), director_ids uuid[] not null default '{}',
 subjects text[] not null, effective_date date not null, exit_kind text not null check(exit_kind in ('withdrawal','subject_end')),
 snapshot jsonb not null, status text not null default 'pending' check(status in ('pending','scheduled','completed','blocked','canceled')),
 created_at timestamptz not null default now(), applied_at timestamptz
);
alter table public.withdrawal_report_groups enable row level security;
revoke all on public.withdrawal_report_groups from public,anon,authenticated;
grant select,insert,update on public.withdrawal_report_groups to service_role;
create unique index withdrawal_report_groups_pending on public.withdrawal_report_groups(tenant_id,student_id) where status not in ('completed','canceled');
alter table public.withdrawal_reports add column group_id uuid references public.withdrawal_report_groups(id) on delete restrict,
 add column group_leader boolean not null default false, add column manager_ids uuid[], add column director_ids uuid[],
 add column manager_decisions jsonb not null default '{}', add column director_decisions jsonb not null default '{}';
alter table public.withdrawal_reports alter column director_id drop not null;
alter table public.withdrawal_reports drop constraint withdrawal_reports_status_check;
alter table public.withdrawal_reports add constraint withdrawal_reports_status_check check(status in ('requested','revision','manager_pending','director_pending','approved','scheduled','completed','blocked','canceled'));
drop index public.withdrawal_reports_one_pending;
create unique index withdrawal_reports_one_pending on public.withdrawal_reports(tenant_id,student_id) where group_id is null and status not in ('completed','canceled');
create unique index withdrawal_reports_group_teacher on public.withdrawal_reports(group_id,teacher_id) where group_id is not null;

create function public.request_withdrawal_report_group(p_tenant uuid,p_actor uuid,p_payload jsonb) returns uuid
language plpgsql security invoker set search_path=public as $$
declare s public.students; actor public.users; snap jsonb; chosen text[]; teachers uuid[]; managers uuid[]; directors uuid[];
 gid uuid; rid uuid; teacher uuid; recipient uuid; subjects_for_teacher text[]; d date; kind text; scope_row jsonb;
begin
 select * into actor from public.users where id=p_actor and tenant_id=p_tenant and status='active';
 if actor.id is null or actor.system_role::text not in ('master','admin','manager') then raise exception '관리자가 작성 요청을 할 수 있습니다.'; end if;
 select * into s from public.students where tenant_id=p_tenant and id=(p_payload->>'studentId')::uuid for update;
 if s.id is null or s.status::text not in ('enrolled','on_hold') or s.withdrawn_at is not null then raise exception '재원·휴원 학생만 요청할 수 있습니다. 기존 퇴원 예약을 확인해 주세요.'; end if;
 perform 1 from public.enrollments where tenant_id=p_tenant and student_id=s.id for update;
 perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=s.id and e.tenant_id=p_tenant for share of c;
 if exists(select 1 from public.withdrawal_reports where tenant_id=p_tenant and student_id=s.id and group_id is null and status not in ('completed','canceled')) then raise exception '이 학생의 진행 중인 보고서가 있습니다.'; end if;
 snap:=public.withdrawal_report_snapshot(p_tenant,s.id);
 select array_agg(distinct v order by v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);
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
 if exists(select 1 from unnest(teachers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('teacher','admin','manager','master')) or not exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=x::text and e->>'subject'=any(chosen))) then raise exception '선택한 수강의 담당 강사를 지정해 주세요.'; end if;
 if exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=any(chosen) and (e->>'teacherId' is null or not (e->>'teacherId')::uuid=any(teachers))) then raise exception '종료할 수강의 담당 강사를 모두 선택해 주세요.'; end if;
 if exists(select 1 from unnest(managers) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text in ('admin','manager','master'))) then raise exception '현재 재직 중인 승인 관리자를 선택해 주세요.'; end if;
 if exists(select 1 from unnest(directors) x where not exists(select 1 from public.users where id=x and tenant_id=p_tenant and status='active' and system_role::text='master' and not coalesce(public.is_super_admin(id),false))) then raise exception '현재 재직 중인 원장을 선택해 주세요.'; end if;
 d:=(p_payload->>'effectiveDate')::date;
 if d is null or d<coalesce(s.enrolled_at,d) or d>(now() at time zone 'Asia/Seoul')::date+365 then raise exception '종료일은 등록일 이후, 오늘부터 1년 이내로 지정해 주세요.'; end if;
 kind:=case when exists(select 1 from jsonb_array_elements(snap->'courses') e where not e->>'subject'=any(chosen)) then 'subject_end' else 'withdrawal' end;
 insert into public.withdrawal_report_groups(tenant_id,student_id,requested_by,teacher_ids,manager_ids,director_ids,subjects,effective_date,exit_kind,snapshot)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap) returning id into gid;
 foreach teacher in array teachers loop
  select array_agg(distinct e->>'subject') into subjects_for_teacher from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=teacher::text and e->>'subject'=any(chosen);
  insert into public.withdrawal_reports(tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,group_id,group_leader,subjects,effective_date,exit_kind,request_note,snapshot)
   values(p_tenant,s.id,p_actor,teacher,managers[1],directors[1],managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap) returning id into rid;
  insert into public.withdrawal_report_events(tenant_id,report_id,actor_id,action,to_status) values(p_tenant,rid,p_actor,'request','requested');
  if teacher<>p_actor then insert into public.notifications(tenant_id,recipient_id,type,title,body,link,actor_id) values(p_tenant,teacher,'approval_requested','퇴원보고서 작성 요청',s.name||' · '||d::text,'/withdrawal-reports/'||rid::text,p_actor); end if;
 end loop;
 return gid;
end $$;
revoke all on function public.request_withdrawal_report_group(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.request_withdrawal_report_group(uuid,uuid,jsonb) to service_role;
commit;
