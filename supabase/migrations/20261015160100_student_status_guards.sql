-- INVOKER is essential: only tightly validated RPCs run as the non-login executor.
create or replace function student_status_private.guard_student() returns trigger
language plpgsql security invoker set search_path=public as $$
declare sensitive boolean;
begin
  if current_user not in ('authenticated','student_status_lifecycle') then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  if tg_op='DELETE' then
    if student_status_private.menu('admin')<>'full' or not student_status_private.office() then
      raise exception '원생 삭제 권한이 없습니다'; end if;
    return old;
  end if;
  if tg_op='INSERT' then
    sensitive:=new.status in ('withdrawn','on_hold') or new.withdrawn_at is not null;
  else
    sensitive:=new.status is distinct from old.status or new.withdrawn_at is distinct from old.withdrawn_at
      or (old.status<>'withdrawn' and old.withdrawn_at is not null and new.withdrawal_metadata is distinct from old.withdrawal_metadata);
  end if;
  if sensitive and (current_user='student_status_lifecycle' or not student_status_private.allowed()) then
    raise exception '원생 상태 변경 권한이 없습니다';
  end if;
  return new;
end $$;

create or replace function student_status_private.guard_enrollment() returns trigger
language plpgsql security invoker set search_path=public as $$
declare inherited boolean; period_end date;
begin
  if current_user not in ('authenticated','student_status_lifecycle') then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  if tg_op<>'DELETE' and (new.tenant_id is distinct from public.auth_tenant_id()
    or not exists(select 1 from public.students where id=new.student_id and tenant_id=new.tenant_id)
    or not exists(select 1 from public.classes where id=new.class_id and tenant_id=new.tenant_id)) then
    raise exception '수강 대상이 이 지점에 없습니다';
  end if;
  -- This role inherits authenticated privileges and still passes the actual office/tenant RLS.
  if current_user='student_status_lifecycle' then
    if tg_op='DELETE' then return old; end if; return new;
  end if;
  if tg_op='DELETE' then
    -- A separately authorized student permanent deletion may cascade to its enrollments.
    if pg_trigger_depth()>1 and not exists(select 1 from public.students where id=old.student_id) then return old; end if;
    raise exception '수강 삭제는 배정 취소 또는 이력 삭제 기능을 이용해 주세요';
  end if;
  if tg_op='INSERT' then
    select status='on_hold' into inherited from public.students where id=new.student_id and tenant_id=new.tenant_id;
    period_end:=public.class_period_closed_end(new.class_id);
    if not coalesce(new.is_transferred,false) and not coalesce(new.is_transferred_in,false)
      and coalesce(new.on_hold,false)=coalesce(inherited,false)
      and (new.end_date is null or (period_end is not null and new.start_date<=period_end
        and new.withdrawal_reason='운영 기간 종료' and new.end_date=period_end)) then return new; end if;
  elsif (new.on_hold,new.start_date,new.end_date,new.withdrawal_reason,new.is_transferred,new.is_transferred_in,new.student_id,new.class_id)
    is not distinct from (old.on_hold,old.start_date,old.end_date,old.withdrawal_reason,old.is_transferred,old.is_transferred_in,old.student_id,old.class_id) then
    return new;
  elsif (to_jsonb(new)-array['start_date','end_date','withdrawal_reason','is_transferred'])
    = (to_jsonb(old)-array['start_date','end_date','withdrawal_reason','is_transferred'])
    and student_status_private.date_allowed(old.class_id)
    and (new.withdrawal_reason is not distinct from old.withdrawal_reason or
      (new.withdrawal_reason is null and (new.end_date is null or old.withdrawal_reason='운영 기간 종료')))
    and (new.is_transferred is not distinct from old.is_transferred or (new.end_date is null and not new.is_transferred)) then
    return new;
  end if;
  if not student_status_private.allowed() then raise exception '원생 상태 변경 권한이 없습니다'; end if;
  return new;
end $$;

revoke all on function student_status_private.guard_student() from public,anon;
revoke all on function student_status_private.guard_enrollment() from public,anon;
drop trigger if exists zz_student_status_authority on public.students;
create trigger zz_student_status_authority before insert or update or delete on public.students
  for each row execute function student_status_private.guard_student();
drop trigger if exists zz_enrollment_status_authority on public.enrollments;
create trigger zz_enrollment_status_authority before insert or update or delete on public.enrollments
  for each row execute function student_status_private.guard_enrollment();
