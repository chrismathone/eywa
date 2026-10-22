-- 요청 당시 선택한 반의 수강 ID를 고정한다. 기존 요청은 당시 과목 범위를 그대로 보존한다.
begin;
set local lock_timeout = '5s';
alter table public.withdrawal_report_groups add column enrollment_ids uuid[];
alter table public.withdrawal_reports add column enrollment_ids uuid[];
update public.withdrawal_report_groups g set enrollment_ids=array(
 select (e->>'id')::uuid from jsonb_array_elements(g.snapshot->'courses') e
 where e->>'subject'=any(g.subjects) order by e->>'id');
update public.withdrawal_reports r set enrollment_ids=array(
 select (e->>'id')::uuid from jsonb_array_elements(r.snapshot->'courses') e
 where e->>'subject'=any(r.subjects) and (r.group_id is null or e->>'teacherId'=r.teacher_id::text) order by e->>'id');

do $$
declare definition text; patch text[];
begin
 select pg_get_functiondef('public.request_withdrawal_report_group(uuid,uuid,jsonb)'::regprocedure) into definition;
 foreach patch slice 1 in array array[
  array[$q$scope_row jsonb;$q$,$q$scope_row jsonb; targets uuid[]; teacher_targets uuid[];$q$],
  array[$q$select array_agg(distinct v order by v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);$q$,$q$if p_payload ? 'enrollmentIds' then
  if jsonb_typeof(p_payload->'enrollmentIds') is distinct from 'array' then raise exception '종료할 반을 선택해 주세요.'; end if;
  select array_agg(distinct v::uuid order by v::uuid) into targets from jsonb_array_elements_text(p_payload->'enrollmentIds') x(v);
  if coalesce(cardinality(targets),0) not between 1 and 100 or exists(select 1 from unnest(targets) x where not exists(select 1 from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=x)) then raise exception '현재 학생이 수강 중인 반을 선택해 주세요.'; end if;
  select array_agg(distinct e->>'subject' order by e->>'subject') into chosen from jsonb_array_elements(snap->'courses') e where (e->>'id')::uuid=any(targets);
 else
  -- 배포 전에 열린 폼은 기존의 명시된 과목 범위를 유지한다.
  select array_agg(distinct v order by v) into chosen from jsonb_array_elements_text(p_payload->'subjects') x(v);
  select array_agg((e->>'id')::uuid order by e->>'id') into targets from jsonb_array_elements(snap->'courses') e where e->>'subject'=any(chosen);
 end if;
 if exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=s.id and e.id=any(targets) and (not c.is_active or c.closed_at is not null)) then raise exception '종강되었거나 운영하지 않는 반은 선택할 수 없습니다. 반 목록을 새로고침해 주세요.'; end if;$q$],
  array[$q$e->>'teacherId'=x::text and e->>'subject'=any(chosen)$q$,$q$e->>'teacherId'=x::text and (e->>'id')::uuid=any(targets)$q$],
  array[$q$if exists(select 1 from jsonb_array_elements(snap->'courses') e where e->>'subject'=any(chosen) and (e->>'teacherId' is null or not (e->>'teacherId')::uuid=any(teachers))) then raise exception '종료할 수강의 담당 강사를 모두 선택해 주세요.'; end if;$q$,$q$-- 종료 대상은 선택한 모든 반, 작성자는 그중 지정한 강사만이다.$q$],
  array[$q$where not e->>'subject'=any(chosen)$q$,$q$where not (e->>'id')::uuid=any(targets) and exists(select 1 from public.classes c where c.id=(e->>'classId')::uuid and c.tenant_id=p_tenant and c.is_active and c.closed_at is null)$q$],
  array[$q$effective_date,exit_kind,snapshot)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap)$q$,$q$effective_date,exit_kind,snapshot,enrollment_ids)
 values(p_tenant,s.id,p_actor,teachers,managers,directors,chosen,d,kind,snap,targets)$q$],
  array[$q$select array_agg(distinct e->>'subject') into subjects_for_teacher from jsonb_array_elements(snap->'courses') e where e->>'teacherId'=teacher::text and e->>'subject'=any(chosen);$q$,$q$select array_agg(distinct e->>'subject'),array_agg((e->>'id')::uuid order by e->>'id') into subjects_for_teacher,teacher_targets from jsonb_array_elements(snap->'courses') e where (cardinality(teachers)=1 or e->>'teacherId'=teacher::text) and (e->>'id')::uuid=any(targets);$q$],
  array[$q$exit_kind,request_note,snapshot)
   values(p_tenant,s.id,p_actor,teacher,managers[1],directors[1],managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap)$q$,$q$exit_kind,request_note,snapshot,enrollment_ids)
   values(p_tenant,s.id,p_actor,teacher,managers[1],directors[1],managers,directors,gid,teacher=teachers[1],subjects_for_teacher,d,kind,coalesce(p_payload->>'note',''),snap,teacher_targets)$q$]
 ] loop
  if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception '0394a: request target patch mismatch'; end if;
  definition:=replace(definition,patch[1],patch[2]);
 end loop;
 execute definition;
 select pg_get_functiondef('public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure) into definition;
 patch:=array[$q$valid:=snap is not distinct from g.snapshot$q$,$q$valid:=snap is not distinct from g.snapshot
   and not exists(select 1 from public.enrollments e join public.classes c on c.id=e.class_id where e.tenant_id=p_tenant and e.student_id=g.student_id and e.id=any(g.enrollment_ids) and (not c.is_active or c.closed_at is not null))$q$];
 if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception '0394a: active class guard patch mismatch'; end if;
 definition:=replace(definition,patch[1],patch[2]);
 patch:=array[
  $q$select array_agg((e->>'id')::uuid) into targets from jsonb_array_elements(g.snapshot->'courses') e where e->>'subject'=any(g.subjects);$q$,
  $q$targets:=g.enrollment_ids;
   if targets is null then raise exception '종료할 반을 확인하지 못했습니다. 요청 내용을 다시 확인해 주세요.'; end if;$q$
 ];
 if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>1 then raise exception '0394a: transition target patch mismatch'; end if;
 definition:=replace(definition,patch[1],patch[2]);
 -- 단일 작성자는 모든 선택 반을 대표한다. 복수 작성 중 생략한 담당 반은 대표 보고서의 사유를 쓴다.
 patch:=array[
  $q$q.group_id=g.id and q.teacher_id=c.teacher_id and c.subject=any(q.subjects) limit 1$q$,
  $q$q.group_id=g.id order by coalesce(e.id=any(q.enrollment_ids),false) desc,q.group_leader desc,q.id limit 1$q$
 ];
 if (length(definition)-length(replace(definition,patch[1],'')))/length(patch[1])<>3 then raise exception '0394a: report reason patch mismatch'; end if;
 execute replace(definition,patch[1],patch[2]);
end $$;
notify pgrst, 'reload schema';
commit;
