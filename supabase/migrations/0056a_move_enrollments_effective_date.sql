-- 시간표 주간 이동(타임머신) Phase B — 미래 예약 반이동.
-- move_enrollments_batch에 p_effective_date(적용일) 추가: 옛 enrollment를 그 날짜에 종료(end_date)하고
-- 새 enrollment를 그 날짜에 시작(start_date). 미래 날짜면 옛 반이 그날까지 유지 → 그 미래 주에서만 이동 반영
-- (현재 주에선 여전히 옛 반에 보임). ijw useStudentDragDrop.scheduledDate 패턴 이식.
--
-- 0027h(인자 1개판)를 대체. SECURITY INVOKER·per-move 서브트랜잭션·RLS(tenant_isolation)는 동일.
-- ⚠️ 손수 alpha(drizzle 무관, 함수). 적용: node --env-file=.env.local raw 실행. db:generate 금지.

-- 옛 1-인자 오버로드 제거(default 인자판이 1-인자 호출도 커버 → 모호성 방지).
drop function if exists public.move_enrollments_batch(jsonb);

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
  m            jsonb;
  v_enr_id     uuid;
  v_new_class  uuid;
  v_start      date;
  v_eff        date := coalesce(p_effective_date, current_date);
  v_student    uuid;
  v_tenant     uuid;
  v_results    jsonb := '[]'::jsonb;
begin
  for m in select value from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) as t(value)
  loop
    v_enr_id    := nullif(m->>'enrollmentId','')::uuid;
    v_new_class := nullif(m->>'newClassId','')::uuid;
    -- 새 반 시작일 = per-move startDate가 있으면 그것, 없으면 적용일(미래 주의 월요일 등).
    v_start     := coalesce(nullif(m->>'startDate','')::date, v_eff);

    begin
      if v_enr_id is null or v_new_class is null then
        raise exception 'invalid_move';
      end if;

      -- 기존 enrollment (RLS가 본 테넌트로 제한 → 없으면 not_found)
      select student_id, tenant_id
        into v_student, v_tenant
        from public.enrollments
       where id = v_enr_id;

      if v_student is null then
        raise exception 'not_found';
      end if;

      -- 1) 기존 종료(적용일) + 반이동 흔적. 미래 적용일이면 그날까지 옛 반 유지(현재 주엔 그대로 보임).
      update public.enrollments
         set end_date = v_eff, withdrawal_reason = '반 이동', is_transferred = true
       where id = v_enr_id;

      -- 2) 새 반에 등록(적용일 시작, 반이동 유입). GiST 충돌 시 이 서브트랜잭션만 롤백.
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in)
        values (v_tenant, v_student, v_new_class, v_start, true);

      v_results := v_results || jsonb_build_object('enrollmentId', v_enr_id, 'ok', true);
    exception when others then
      v_results := v_results
        || jsonb_build_object('enrollmentId', coalesce(v_enr_id::text, m->>'enrollmentId'),
                              'ok', false, 'error', sqlerrm);
    end;
  end loop;

  return v_results;
end;
$$;
