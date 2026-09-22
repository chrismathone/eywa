-- 단건/시간표 이동과 단체 이동이 같은 출발 수강을 동시에 옮겨도 한 번만 처리한다.
-- 0235a 계약(개별 시작일, 휴원/요일, 부분 실패, 새 수강 id)은 유지한다.
create or replace function public.move_enrollments_batch(
  p_moves jsonb,
  p_effective_date date default current_date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  m jsonb;
  v_enr_id uuid;
  v_new_class uuid;
  v_start date;
  v_eff date := coalesce(p_effective_date, current_date);
  v_student uuid;
  v_tenant uuid;
  v_on_hold boolean;
  v_transferred boolean;
  v_attend text[];
  v_new_id uuid;
  v_results jsonb := '[]'::jsonb;
begin
  for m in select value from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) as t(value)
  loop
    v_enr_id := nullif(m->>'enrollmentId','')::uuid;
    v_new_class := nullif(m->>'newClassId','')::uuid;
    v_start := coalesce(nullif(m->>'startDate','')::date, v_eff);
    v_attend := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(m->'attendanceDays', '[]'::jsonb)) as x),
      '{}'::text[]
    );
    v_new_id := null;
    begin
      if v_enr_id is null or v_new_class is null then raise exception 'invalid_move'; end if;
      select student_id, tenant_id, on_hold, is_transferred
        into v_student, v_tenant, v_on_hold, v_transferred
        from public.enrollments where id = v_enr_id for update;
      if v_student is null then raise exception 'not_found'; end if;
      if v_transferred then
        raise exception '이미 반 이동이 처리되었거나 예약되어 있습니다. 수강 내역을 확인해 주세요.';
      end if;
      update public.enrollments
        set end_date = v_eff, withdrawal_reason = '반 이동', is_transferred = true
        where id = v_enr_id;
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days, on_hold)
        values (v_tenant, v_student, v_new_class, v_start, true, v_attend, coalesce(v_on_hold, false))
        returning id into v_new_id;
      v_results := v_results || jsonb_build_object('enrollmentId', v_enr_id, 'newEnrollmentId', v_new_id, 'ok', true);
    exception when others then
      v_results := v_results || jsonb_build_object('enrollmentId', coalesce(v_enr_id::text, m->>'enrollmentId'), 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return v_results;
end;
$$;
