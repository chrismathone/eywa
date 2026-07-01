-- 시간표 반이동에 "요일 지정"(분리등원) 추가 — move_enrollments_batch가 per-move attendance_days를 받아
-- 새 enrollment에 세팅한다. 드롭한 요일 존이 곧 목적지 등원 요일(ijw useStudentDragDrop: toZone='common'?[]:[day]).
--   · attendanceDays 빈 배열/미지정 = 전 요일 등원(분리 아님)
--   · ['thu'] = 목요일만 등원
-- 0056a(effective_date 판)를 대체. SECURITY INVOKER·per-move 서브트랜잭션·RLS(tenant_isolation)는 동일.
-- GiST enrollments_no_overlap은 daterange가 '[)' 반열림이라, old end_date=eff / new start_date=eff여도
-- 같은 반(same-class) 경계에서 겹치지 않는다(eff는 new에만 포함) — end_date를 eff-1로 바꿀 필요 없음.
-- ⚠️ 손수 alpha(drizzle 무관, 함수). 적용: node --env-file=.env.local raw 실행. db:generate 금지.

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
  v_attend     text[];
  v_results    jsonb := '[]'::jsonb;
begin
  for m in select value from jsonb_array_elements(coalesce(p_moves, '[]'::jsonb)) as t(value)
  loop
    v_enr_id    := nullif(m->>'enrollmentId','')::uuid;
    v_new_class := nullif(m->>'newClassId','')::uuid;
    -- 새 반 시작일 = per-move startDate가 있으면 그것, 없으면 적용일(미래 주의 월요일 등).
    v_start     := coalesce(nullif(m->>'startDate','')::date, v_eff);
    -- 목적지 등원 요일(분리등원) — jsonb 배열 → text[]. 없으면 빈 배열(전 요일 등원).
    v_attend    := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(m->'attendanceDays', '[]'::jsonb)) as x),
      '{}'::text[]
    );

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

      -- 2) 새 반에 등록(적용일 시작, 반이동 유입, 요일 지정). GiST 충돌 시 이 서브트랜잭션만 롤백.
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days)
        values (v_tenant, v_student, v_new_class, v_start, true, v_attend);

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
