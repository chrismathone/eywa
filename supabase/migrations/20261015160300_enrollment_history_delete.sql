-- Read-only record probe uses a fixed tenant/student/class predicate, including tables
-- whose RLS hides records. The actual DELETE runs under authenticated RLS via the executor.
create or replace function student_status_private.record_counts(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e public.enrollments%rowtype;
begin
  if not student_status_private.office() then raise exception '수강 기록을 확인할 권한이 없습니다'; end if;
  select * into e from public.enrollments where id=p_id and tenant_id=public.auth_tenant_id();
  if not found then raise exception '수강 기록을 찾을 수 없습니다'; end if;
  return jsonb_build_object(
    'attendance',(select count(*) from public.attendance_records where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id),
    'lessonReports',(select count(*) from public.lesson_reports where tenant_id=e.tenant_id and student_id=e.student_id and (class_id=e.class_id or makeup_class_id=e.class_id)),
    'onescreenSessions',(select count(*) from public.onescreen_daily_sessions where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id),
    'sheetMarks',(select count(*) from public.class_sheet_student_marks where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id
      and (status is not null or progress_note is not null or score is not null or listening_level is not null)),
    'followups',(select count(*) from public.attendance_followups where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id),
    'billing',(select count(*) from public.invoice_session_terms x join public.invoices i on i.id=x.invoice_id
      where x.tenant_id=e.tenant_id and i.tenant_id=e.tenant_id and i.student_id=e.student_id and x.class_id=e.class_id)
      +(select count(*) from public.invoice_teacher_splits x join public.invoices i on i.id=x.invoice_id
      where x.tenant_id=e.tenant_id and i.tenant_id=e.tenant_id and i.student_id=e.student_id and x.class_id=e.class_id));
end $$;
revoke all on function student_status_private.record_counts(uuid) from public,anon;
grant execute on function student_status_private.record_counts(uuid) to authenticated;

create or replace function public.delete_enrollment_history(p_id uuid,p_expected jsonb)
returns setof uuid language plpgsql security definer set search_path=public set row_security=on as $$
declare e public.enrollments%rowtype; owner_level boolean; counts jsonb; sibling boolean; sibling_tier boolean;
  class_name text; class_subject text;
begin
  if not student_status_private.office() then raise exception '수강 삭제 권한이 없습니다'; end if;
  owner_level:=student_status_private.menu('owner')='full' or public.is_super_admin(auth.uid());
  if not owner_level and student_status_private.menu('students')<>'full' then raise exception '수강 삭제 권한이 없습니다'; end if;
  -- Lock the entire pair deterministically before checking retained records/tier ownership.
  perform id from public.enrollments where tenant_id=public.auth_tenant_id() and (student_id,class_id) in
    (select student_id,class_id from public.enrollments where id=p_id and tenant_id=public.auth_tenant_id()) order by id for update;
  select * into e from public.enrollments where id=p_id and tenant_id=public.auth_tenant_id();
  if not found then raise exception '수강 기록을 찾을 수 없습니다'; end if;
  if p_expected is null or not (to_jsonb(e) @> p_expected) then raise exception '수강 기록이 변경되었습니다. 새로고침해 주세요'; end if;
  if not owner_level and e.start_date<=(now() at time zone 'Asia/Seoul')::date then raise exception '이미 시작한 수강은 수강 종료로 처리해 주세요'; end if;
  if (e.is_transferred_in and e.start_date>(now() at time zone 'Asia/Seoul')::date)
    or (e.is_transferred and e.end_date>(now() at time zone 'Asia/Seoul')::date) then
    raise exception '예약된 반 이동은 예정된 변경에서 취소해 주세요'; end if;
  counts:=student_status_private.record_counts(p_id);
  select exists(select 1 from public.enrollments where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id and id<>e.id),
    exists(select 1 from public.enrollments where tenant_id=e.tenant_id and student_id=e.student_id and class_id=e.class_id and id<>e.id and salary_tier is not null)
    into sibling,sibling_tier;
  if (sibling and e.salary_tier is not null and not sibling_tier and (counts->>'attendance')::int>0)
    or (not sibling and exists(select 1 from jsonb_each_text(counts) x where x.value::int>0)) then
    raise exception '연결된 기록이 있어 삭제할 수 없습니다. 수강 종료를 이용해 주세요'; end if;
  select c.class_name,c.subject::text into class_name,class_subject from public.classes c where c.id=e.class_id and c.tenant_id=e.tenant_id;
  delete from public.enrollments where id=e.id and tenant_id=e.tenant_id;
  if not found then raise exception '수강 기록을 삭제하지 못했습니다'; end if;
  insert into public.audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
    values(e.tenant_id,auth.uid(),(select display_name from public.users where id=auth.uid()),'enrollment_delete','student',class_name,
      jsonb_build_object('studentId',e.student_id,'classId',e.class_id,'className',class_name,'subject',class_subject,'via','validated_rpc',
        'snapshot',jsonb_build_object('id',e.id,'tenantId',e.tenant_id,'studentId',e.student_id,'classId',e.class_id,
          'startDate',e.start_date,'endDate',e.end_date,'onHold',e.on_hold,'withdrawalReason',e.withdrawal_reason,
          'attendanceDays',e.attendance_days,'isTransferred',e.is_transferred,'isTransferredIn',e.is_transferred_in,
          'salaryTier',e.salary_tier,'createdAt',e.created_at),
        'recordCounts',counts,'cancelledBeforeStart',e.start_date>(now() at time zone 'Asia/Seoul')::date,
        'hadSiblingEnrollment',sibling,'thisRowHasTier',e.salary_tier is not null,'siblingHasTier',sibling_tier));
  return next e.id;
end $$;
grant create on schema public to student_status_lifecycle;
alter function public.delete_enrollment_history(uuid,jsonb) owner to student_status_lifecycle;
revoke create on schema public from student_status_lifecycle;
revoke all on function public.delete_enrollment_history(uuid,jsonb) from public,anon;
grant execute on function public.delete_enrollment_history(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
