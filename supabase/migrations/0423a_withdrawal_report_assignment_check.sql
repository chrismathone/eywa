begin;
set local lock_timeout='5s';
-- Re-check the same live class ownership used by request creation before accepting an author's submission.
create function public.check_withdrawal_report_submission() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.status='manager_pending' and old.status in ('requested','revision') then
  perform 1 from public.students where id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.enrollments where student_id=new.student_id and tenant_id=new.tenant_id for update;
  perform 1 from public.classes c join public.enrollments e on e.class_id=c.id where e.student_id=new.student_id and e.tenant_id=new.tenant_id for share of c;
  if public.withdrawal_report_snapshot(new.tenant_id,new.student_id) is distinct from new.snapshot then raise exception '요청 이후 학생·수강·담당 강사가 변경되었습니다. 관리자에게 요청을 다시 작성해 달라고 알려 주세요.'; end if;
 end if;
 return new;
end $$;
revoke all on function public.check_withdrawal_report_submission() from public,anon,authenticated;
create trigger withdrawal_report_submission_assignment before update on public.withdrawal_reports for each row execute function public.check_withdrawal_report_submission();
commit;
