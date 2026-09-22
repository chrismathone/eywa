-- 같은 출발 반의 선택 수강을 이동한다. 기존 시간표/import RPC의 계약은 유지한다.
-- 목록 스냅샷 + 행 잠금으로 중복 제출/동시 이동을 막고, 학생별 서브트랜잭션으로 실패를 격리한다.
create or replace function public.move_class_enrollments_batch(
  p_source_class_id uuid,
  p_moves jsonb,
  p_effective_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m jsonb;
  old_enrollment public.enrollments%rowtype;
  target_class public.classes%rowtype;
  new_id uuid;
  changed integer;
  results jsonb := '[]'::jsonb;
begin
  if p_source_class_id is null or p_effective_date is null
    or p_effective_date < (now() at time zone 'Asia/Seoul')::date
    or jsonb_typeof(p_moves) is distinct from 'array'
    or jsonb_array_length(p_moves) not between 1 and 100 then
    raise exception 'invalid_transfer_request';
  end if;
  if (select count(distinct value->>'enrollmentId') from jsonb_array_elements(p_moves))
       <> jsonb_array_length(p_moves)
    or (select count(distinct value->>'newClassId') from jsonb_array_elements(p_moves)) <> 1 then
    raise exception 'invalid_transfer_request';
  end if;

  -- 겹치는 학생을 동시에 선택해도 잠금 순서는 항상 id 순으로 유지한다.
  for m in select value from jsonb_array_elements(p_moves) order by value->>'enrollmentId'
  loop
    begin
      select * into old_enrollment from public.enrollments
        where id = (m->>'enrollmentId')::uuid and class_id = p_source_class_id for update;
      if not found then raise exception 'transfer_source_missing'; end if;
      if old_enrollment.is_transferred then raise exception 'transfer_already_moved'; end if;
      if (m->'expected') is distinct from jsonb_build_object(
        'studentId', old_enrollment.student_id,
        'startDate', old_enrollment.start_date,
        'endDate', old_enrollment.end_date,
        'onHold', old_enrollment.on_hold,
        'isTransferred', old_enrollment.is_transferred,
        'attendanceDays', old_enrollment.attendance_days
      ) then raise exception 'transfer_source_changed'; end if;
      if p_effective_date < old_enrollment.start_date
        or (old_enrollment.end_date is not null and p_effective_date > old_enrollment.end_date) then
        raise exception 'transfer_invalid_period';
      end if;
      select * into target_class from public.classes
        where id = (m->>'newClassId')::uuid and tenant_id = old_enrollment.tenant_id
          and id <> p_source_class_id and is_active for share;
      if not found then raise exception 'transfer_target_missing'; end if;

      update public.enrollments
        set end_date = p_effective_date, withdrawal_reason = '반 이동', is_transferred = true
        where id = old_enrollment.id;
      get diagnostics changed = row_count;
      if changed <> 1 then raise exception 'transfer_source_missing'; end if;

      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days, on_hold)
        values (old_enrollment.tenant_id, old_enrollment.student_id, target_class.id,
          p_effective_date, true,
          coalesce((select array_agg(day) from jsonb_array_elements_text(m->'attendanceDays') day), '{}'::text[]),
          old_enrollment.on_hold)
        returning id into new_id;
      results := results || jsonb_build_object('enrollmentId', old_enrollment.id, 'newEnrollmentId', new_id, 'ok', true);
    exception when others then
      results := results || jsonb_build_object('enrollmentId', m->>'enrollmentId', 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end;
$$;
revoke all on function public.move_class_enrollments_batch(uuid, jsonb, date) from public, anon;
grant execute on function public.move_class_enrollments_batch(uuid, jsonb, date) to authenticated;
