-- Additive v2 contact projection for manager-triggered student account issuance.
-- Existing snapshots remain valid. Export only four digits, never full phone numbers.
begin;
create or replace function tm_sync_private.contact_phone_last4(p_student_phone text, p_parent_phone text)
returns text language sql immutable set search_path = '' as $$
 select case
  when length(regexp_replace(coalesce(p_student_phone,''),'[^0-9]','','g'))>=7
   then right(regexp_replace(p_student_phone,'[^0-9]','','g'),4)
  when length(regexp_replace(coalesce(p_parent_phone,''),'[^0-9]','','g'))>=7
   then right(regexp_replace(p_parent_phone,'[^0-9]','','g'),4)
  else null end;
$$;
revoke all on function tm_sync_private.contact_phone_last4(text,text) from public,anon,authenticated,service_role;

create or replace function tm_sync_private.export_rows(p_binding_id uuid)
returns jsonb language sql stable set search_path = '' as $$
 with b as (select * from tm_sync_private.bindings where id=p_binding_id),
 c as materialized (
  select c.*,coalesce(cs.permission_revision,0) permission_revision,public.class_period_closed_end(c.id) period_end
  from b join public.classes c on c.tenant_id=b.tenant_id and c.subject='math'
  left join tm_sync_private.class_state cs on cs.binding_id=b.id and cs.class_id=c.id
 ), st as materialized (
  select s.* from b join public.students s on s.tenant_id=b.tenant_id and not s.is_test
  where exists(select 1 from public.enrollments e join c on c.id=e.class_id
   where e.tenant_id=b.tenant_id and e.student_id=s.id)
 ), ctrl as (select public.tm_sync_control(p_binding_id) j)
 select jsonb_build_object('control',ctrl.j,'collections',jsonb_build_object(
 'staff',ctrl.j->'users',
 'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.class_name,'subject',c.subject,
   'grade',null,'active',c.is_active and c.period_end is null and (c.closed_at is null or c.closed_at>=(statement_timestamp() at time zone 'Asia/Seoul')::date),
   'closedAt',tm_sync_private.iso(((coalesce(c.closed_at,c.period_end)+1)::timestamp at time zone 'Asia/Seoul')),
   'teacherId',c.teacher_id,'permissionRevision',c.permission_revision::text) order by c.id) from c),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'classId',m.class_id,'userId',m.user_id,
   'role',m.member_role,'startsOn',m.starts_on,'endsOn',m.ends_on,'revokedAt',tm_sync_private.iso(m.revoked_at),
   'capabilities',m.capabilities) order by m.id) from b cross join lateral tm_sync_private.memberships(b.tenant_id) m
   where not exists(select 1 from public.super_admins a where a.id=m.user_id)),'[]'::jsonb),
 'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade,'school',s.school,
   'status',case when s.withdrawn_at<=(statement_timestamp() at time zone 'Asia/Seoul')::date then 'withdrawn' else s.status::text end,
   'isTest',s.is_test,'phoneLast4',tm_sync_private.contact_phone_last4(s.student_phone,s.parent_phone)) order by s.id) from st s),'[]'::jsonb),
 'enrollments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'studentId',e.student_id,'classId',e.class_id,
   'startsOn',e.start_date,'endsOn',case when e.end_date is null and e.start_date<=c.period_end then c.period_end else e.end_date end,
   'onHold',e.on_hold,'isTransferred',e.is_transferred,'attendanceDays',e.attendance_days) order by e.id)
   from b join public.enrollments e on e.tenant_id=b.tenant_id join c on c.id=e.class_id join st on st.id=e.student_id),'[]'::jsonb),
 'progress',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'studentId',r.student_id,'classId',r.class_id,
   'makeupClassId',r.makeup_class_id,'reportDate',r.report_date,'createdAt',tm_sync_private.iso(r.created_at),'progress',r.progress)
   order by r.report_date,r.created_at,r.id)
   from b join public.lesson_reports r on r.tenant_id=b.tenant_id join st on st.id=r.student_id
   where r.progress is not null and r.subject='math'
    and (r.class_id is null or exists(select 1 from c where c.id=r.class_id))
    and (r.makeup_class_id is null or exists(select 1 from c where c.id=r.makeup_class_id))),'[]'::jsonb)
 )) from ctrl;
$$;

-- Phone edits invalidate content; the notification contains no phone values.
drop trigger if exists tm_sync_content on public.students;
create trigger tm_sync_content after insert or update or delete on public.students for each row
 execute function tm_sync_private.capture_content('id,tenant_id,name,grade,school,student_phone,parent_phone');

-- The schema-health guard verifies function definitions. Authorize this exact replacement.
insert into tm_sync_private.function_contract(signature,definition_hash)
 select signature,tm_sync_private.hash(pg_get_functiondef(to_regprocedure(signature)))
 from unnest(array['tm_sync_private.export_rows(uuid)','tm_sync_private.contact_phone_last4(text,text)']) signature
 on conflict(signature) do update set definition_hash=excluded.definition_hash;

-- Preserve the exact-count guard and include the newly fingerprinted helper.
create or replace function tm_sync_private.healthy() returns boolean
language sql stable set search_path = '' as $$
 select (select count(*) from tm_sync_private.trigger_contract) = 20
 and not exists (
  select 1 from tm_sync_private.trigger_contract e
  left join pg_class c on c.oid=to_regclass(e.relation_name)
  left join pg_trigger t on t.tgrelid=c.oid and t.tgname=e.trigger_name and not t.tgisinternal
  where t.oid is null or t.tgenabled not in ('O','A')
    or tm_sync_private.hash(pg_get_triggerdef(t.oid)) <> e.definition_hash
    or tm_sync_private.hash(pg_get_functiondef(t.tgfoid)) <> e.function_hash
 ) and (select count(*) from tm_sync_private.function_contract)=12
 and not exists(select 1 from tm_sync_private.function_contract f
   where to_regprocedure(f.signature) is null
    or tm_sync_private.hash(pg_get_functiondef(to_regprocedure(f.signature)))<>f.definition_hash)
 and to_regprocedure('public.class_period_closed_end(uuid)') is not null;
$$;

do $$ begin
 if not tm_sync_private.healthy() then
  raise exception 'Contact projection health check failed';
 end if;
end; $$;

insert into tm_sync_private.content_dirty(binding_id) select id from tm_sync_private.bindings
 on conflict(binding_id) do update set changed_at=clock_timestamp();
select tm_sync_private.wake(id) from tm_sync_private.bindings;
commit;
