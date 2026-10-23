-- Read-only aggregation. Server verifies both menus, pilot/lab and original student scope before calling.
-- Temporal SQL mirrors eligibility.isEnrollmentOnRosterOn and isDelegationActiveOn;
-- the local verifier compares boundary fixtures with those existing TypeScript rules.
-- Publish the function and its server-only grants atomically.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create or replace function public.student_ontology_current_scope(
  p_tenant uuid, p_students uuid[], p_kind text, p_entity text, p_search text default '', p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if p_tenant is null or p_students is null or p_kind is null or p_kind not in ('academy','student','class','teacher','subject')
    or p_entity is null or length(coalesce(p_search,''))>100 or p_page is null or p_page<1 or p_page>100000
    or (p_kind='academy' and p_entity<>p_tenant::text) then
    raise exception '조회 범위를 확인해 주세요';
  end if;
  with roster as materialized (
    select e.id enrollment_id,e.student_id,e.class_id,e.on_hold,c.class_name,c.subject,c.teacher_id
    from enrollments e join students s on s.id=e.student_id and s.tenant_id=p_tenant
    join classes c on c.id=e.class_id and c.tenant_id=p_tenant
    where e.tenant_id=p_tenant and e.student_id=any(p_students) and not coalesce(s.is_test,false)
      and not coalesce(c.is_makeup_pool,false) and (c.closed_at is null or c.closed_at>=today)
      and e.start_date<=today and (e.end_date is null or e.end_date>today or (e.end_date=today and not coalesce(e.is_transferred,false)))
  ), classes_in_scope as materialized (select distinct class_id,class_name,subject,teacher_id from roster),
  source_roles as materialized (
    select c.class_id,c.teacher_id,'homeroom'::text role,c.class_id source_id from classes_in_scope c where c.teacher_id is not null
    union all
    select s.class_id,s.teacher_id,'scheduledTeacher',s.id from class_schedules s join classes_in_scope c on c.class_id=s.class_id
      where s.tenant_id=p_tenant and s.teacher_id is not null and (s.valid_from is null or s.valid_from<=today) and (s.valid_to is null or s.valid_to>=today)
    union all
    select d.class_id,d.delegate_user_id,'delegatedTeacher',d.id from class_delegations d join classes_in_scope c on c.class_id=d.class_id
      where d.tenant_id=p_tenant and d.revoked_at is null and d.from_date<=today and d.to_date>=today
  ), roles as materialized (
    select r.* from source_roles r join users u on u.id=r.teacher_id and u.tenant_id=p_tenant
  ), scope_roster as materialized (
    select r.* from roster r where p_kind='academy' or (p_kind='student' and r.student_id::text=p_entity)
      or (p_kind='class' and r.class_id::text=p_entity) or (p_kind='subject' and r.subject=p_entity)
      or (p_kind='teacher' and exists(select 1 from roles t where t.class_id=r.class_id and t.teacher_id::text=p_entity))
  ), scoped_students as materialized (
    select s.id,s.name,s.school,s.grade from students s where s.tenant_id=p_tenant and exists(select 1 from scope_roster r where r.student_id=s.id)
  ), filtered as materialized (
    select * from scoped_students where coalesce(p_search,'')='' or position(lower(p_search) in lower(coalesce(name,'')||' '||coalesce(school,'')))>0
  ), counts as (
    select (select count(*) from scoped_students)::integer total,(select count(*) from filtered)::integer filtered_total,
      count(distinct class_id)::integer classes,count(distinct subject)::integer subjects,
      (select count(distinct t.teacher_id) from roles t where exists(select 1 from scope_roster r where r.class_id=t.class_id))::integer teachers,
      count(distinct class_id) filter(where not exists(select 1 from source_roles t where t.class_id=scope_roster.class_id))::integer unassigned,
      (select count(*) from source_roles t where exists(select 1 from scope_roster r where r.class_id=t.class_id)
        and not exists(select 1 from users u where u.id=t.teacher_id and u.tenant_id=p_tenant))::integer unresolved
    from scope_roster
  ), pager as (select least(p_page,greatest(1,ceil(filtered_total/20.0)::integer)) page from counts),
  page_students as materialized (select * from filtered order by name,id limit 20 offset (select (page-1)*20 from pager)),
  nodes as materialized (
    select 'academy'::text kind,p_tenant::text id,'학원 전체'::text label,r.student_id,r.class_id from roster r
    union all select 'student',s.id::text,s.name,r.student_id,r.class_id from roster r join students s on s.id=r.student_id and s.tenant_id=p_tenant
    union all select 'class',r.class_id::text,r.class_name,r.student_id,r.class_id from roster r
    union all select 'subject',r.subject,r.subject,r.student_id,r.class_id from roster r
    union all select 'teacher',t.teacher_id::text,coalesce(u.display_name,'이름 확인 필요'),r.student_id,r.class_id
      from roster r join roles t on t.class_id=r.class_id left join users u on u.id=t.teacher_id and u.tenant_id=p_tenant
  ), options as (select kind,id,label,count(distinct student_id)::integer students from nodes group by kind,id,label),
  connections as (
    select n.kind,n.id,n.label,count(distinct n.student_id)::integer students from nodes n
      where n.kind<>'student' and not(n.kind=p_kind and n.id=p_entity) and exists(select 1 from scope_roster r where r.student_id=n.student_id and r.class_id=n.class_id)
      group by n.kind,n.id,n.label
  )
  select jsonb_build_object('version','student-current-scope-v1','asOf',today,'checkedAt',now(),
    'total',c.total,'filteredTotal',c.filtered_total,'classCount',c.classes,'teacherCount',c.teachers,'subjectCount',c.subjects,
    'unassignedClasses',c.unassigned,'unresolvedAssignments',c.unresolved,'page',(select page from pager),'pageSize',20,
    'options',coalesce((select jsonb_agg(to_jsonb(o) order by o.kind,o.label,o.id) from options o),'[]'::jsonb),
    'connections',coalesce((select jsonb_agg(to_jsonb(n) order by n.kind,n.students desc,n.label,n.id) from connections n),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'school',s.school,'grade',s.grade,
      'classes',(select coalesce(jsonb_agg(jsonb_build_object('id',r.class_id,'name',r.class_name,'subject',r.subject,'onHold',r.on_hold,
        'enrollmentIds',r.ids,'teachers',(select coalesce(jsonb_agg(jsonb_build_object('role',t.role,'teacherId',t.teacher_id,
          'name',coalesce(u.display_name,'이름 확인 필요'),'sourceId',t.source_id) order by t.role,t.teacher_id,t.source_id),'[]'::jsonb)
          from roles t left join users u on u.id=t.teacher_id and u.tenant_id=p_tenant where t.class_id=r.class_id)) order by r.class_name,r.class_id),'[]'::jsonb)
        from (select class_id,class_name,subject,bool_and(coalesce(on_hold,false)) on_hold,array_agg(enrollment_id order by enrollment_id) ids
          from scope_roster where student_id=s.id group by class_id,class_name,subject) r)) order by s.name,s.id) from page_students s),'[]'::jsonb))
    into result from counts c;
  return result;
end;
$$;
revoke all on function public.student_ontology_current_scope(uuid,uuid[],text,text,text,integer) from public,anon,authenticated;
grant execute on function public.student_ontology_current_scope(uuid,uuid[],text,text,text,integer) to service_role;
comment on function public.student_ontology_current_scope(uuid,uuid[],text,text,text,integer) is
  '현재 수강·담당 연결의 선택 관점과 20명 페이지. 원본 학생 권한을 확인한 서버 전용. 마감 기여도·실제 수업 실시·강사 성과를 뜻하지 않는다.';
commit;
