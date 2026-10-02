-- 예약 수정·취소는 두 수강을 같은 트랜잭션에서 처리한다.
-- 저장된 전출 end_date는 배타 경계(이동일), 화면의 마지막 수강일은 그 전날이다.
create or replace function public.change_scheduled_enrollment(
  p_enrollment_id uuid,
  p_paired_enrollment_id uuid,
  p_action text,
  p_date date default null,
  p_class_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  upcoming public.enrollments%rowtype;
  previous public.enrollments%rowtype;
  today date := (now() at time zone 'Asia/Seoul')::date;
  next_date date;
  next_class uuid;
  changed integer;
begin
  if auth.uid() is null or p_action not in ('cancel', 'reschedule') or p_action is null then
    raise exception 'scheduled_invalid_request';
  end if;
  -- 같은 예약을 동시에 수정해도 출발·도착 수강을 id 순서로 잠근다.
  perform id from public.enrollments
    where id in (p_enrollment_id, p_paired_enrollment_id) order by id for update;
  select * into upcoming from public.enrollments where id = p_enrollment_id;
  if not found then raise exception 'scheduled_missing'; end if;
  if upcoming.start_date <= today then raise exception 'scheduled_started'; end if;
  if upcoming.is_transferred then raise exception 'scheduled_has_next_move'; end if;
  if upcoming.is_transferred_in and p_paired_enrollment_id is null then
    raise exception 'scheduled_pair_changed';
  end if;
  if p_paired_enrollment_id is not null then
    select * into previous from public.enrollments where id = p_paired_enrollment_id;
    if not found or previous.id = upcoming.id or previous.student_id <> upcoming.student_id
      or previous.tenant_id <> upcoming.tenant_id or previous.class_id = upcoming.class_id
      or not upcoming.is_transferred_in or not previous.is_transferred
      or previous.withdrawal_reason is distinct from '반 이동'
      or previous.end_date is distinct from upcoming.start_date then
      raise exception 'scheduled_pair_changed';
    end if;
    if (select count(*) from public.enrollments where student_id = upcoming.student_id
          and end_date = upcoming.start_date and is_transferred and class_id <> upcoming.class_id) <> 1
      or (select count(*) from public.enrollments where student_id = upcoming.student_id
          and start_date = upcoming.start_date and is_transferred_in and class_id <> previous.class_id) <> 1 then
      raise exception 'scheduled_pair_changed';
    end if;
  end if;

  if p_action = 'cancel' then
    delete from public.enrollments where id = upcoming.id;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'scheduled_changed'; end if;
    if previous.id is not null then
      update public.enrollments set end_date = null, is_transferred = false, withdrawal_reason = null
        where id = previous.id;
      get diagnostics changed = row_count;
      if changed <> 1 then raise exception 'scheduled_changed'; end if;
    end if;
  else
    next_date := coalesce(p_date, upcoming.start_date);
    next_class := coalesce(p_class_id, upcoming.class_id);
    if next_date <= today then raise exception 'scheduled_invalid_date'; end if;
    if (upcoming.end_date is not null and next_date > upcoming.end_date)
      or (previous.id is not null and (next_date < previous.start_date or next_class = previous.class_id)) then
      raise exception 'scheduled_invalid_period';
    end if;
    perform id from public.classes where id = next_class and tenant_id = upcoming.tenant_id and is_active for share;
    if not found then raise exception 'scheduled_target_missing'; end if;
    update public.enrollments set start_date = next_date, class_id = next_class where id = upcoming.id;
    get diagnostics changed = row_count;
    if changed <> 1 then raise exception 'scheduled_changed'; end if;
    if previous.id is not null then
      update public.enrollments set end_date = next_date where id = previous.id;
      get diagnostics changed = row_count;
      if changed <> 1 then raise exception 'scheduled_changed'; end if;
    end if;
  end if;
  return jsonb_build_object(
    'ok', true, 'studentId', upcoming.student_id, 'classId', upcoming.class_id,
    'fromClassId', previous.class_id, 'startDate', upcoming.start_date,
    'nextClassId', next_class, 'nextDate', next_date
  );
exception when others then
  -- 이 블록의 모든 쓰기가 롤백된 뒤 오류를 반환한다. 한쪽만 처리된 상태가 남지 않는다.
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end;
$$;
revoke all on function public.change_scheduled_enrollment(uuid, uuid, text, date, uuid) from public, anon;
grant execute on function public.change_scheduled_enrollment(uuid, uuid, text, date, uuid) to authenticated;
notify pgrst, 'reload schema';
