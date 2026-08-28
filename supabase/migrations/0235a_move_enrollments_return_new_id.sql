-- 반 이동 RPC가 **새로 만든 수강의 id를 돌려준다** — 되돌리기를 '좌표'가 아니라 'id'로 하기 위해.
--
-- 🔴 왜 필요한가(2026-08-29 적대 리뷰 codex·grok 합의): `rollback_enrollment_import`(0233a)는 새 수강을
--    `(student_id, class_id = toClassId, start_date = 적용일)` **좌표**로 찾아 지운다. 그 좌표는 누구든
--    날짜나 반을 바꾸는 순간 깨진다 —
--      · 대상 반을 바꾸면 → delete가 0건, 옛 수강만 재개방 = **이중 등록**(다른 반이라 GiST도 안 막는다)
--      · 적용일을 바꾸면 → delete·update 둘 다 0건 = 되돌리기가 **조용한 no-op**("모든 게 무로"가 거짓말)
--    그리고 이건 가상의 위험이 아니다: `EditableDateCell`(학생 상세 수업 탭·반 상세 명단)이 **지금도**
--    `updateEnrollmentDates`로 그 행의 start_date를 바꾼다. 즉 예약 배너를 만들기 전부터 재현 가능하다.
--
-- 고침의 절반이 여기다: RPC가 `newEnrollmentId`를 결과에 실어야 호출부가 스냅샷에 적어 둘 수 있다.
-- 나머지 절반은 0236a(롤백이 그 id를 우선 사용).
--
-- 0228a(on_hold 승계판)를 대체 — **그 파일은 고치지 않고** 전체 정의를 여기 다시 쓴다(0228a가 0063a를
-- 대체한 방식 그대로). 변경은 두 줄뿐이다: insert에 `returning id`를 받고, 결과 객체에 그 id를 싣는다.
-- 🔴 **호출부 변경 0 = 무중단** — 옛 코드는 결과의 새 키를 그냥 무시한다([[#95]] expand/contract).
--
-- SECURITY INVOKER·per-move 서브트랜잭션·RLS(tenant_isolation)·on_hold/요일 승계는 0228a와 동일.
-- GiST enrollments_no_overlap은 daterange가 '[)' 반열림이라, old end_date=eff / new start_date=eff여도
-- 같은 반 경계에서 겹치지 않는다(eff는 new에만 포함).
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
  v_on_hold    boolean;
  v_attend     text[];
  v_new_id     uuid;
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
    v_new_id    := null;

    begin
      if v_enr_id is null or v_new_class is null then
        raise exception 'invalid_move';
      end if;

      -- 기존 enrollment (RLS가 본 테넌트로 제한 → 없으면 not_found).
      -- on_hold까지 읽어 새 행에 승계한다 — 반을 옮겼다고 휴원이 풀리는 것은 사실이 아니다.
      select student_id, tenant_id, on_hold
        into v_student, v_tenant, v_on_hold
        from public.enrollments
       where id = v_enr_id;

      if v_student is null then
        raise exception 'not_found';
      end if;

      -- 1) 기존 종료(적용일) + 반이동 흔적. 미래 적용일이면 그날까지 옛 반 유지(현재 주엔 그대로 보임).
      update public.enrollments
         set end_date = v_eff, withdrawal_reason = '반 이동', is_transferred = true
       where id = v_enr_id;

      -- 2) 새 반에 등록(적용일 시작, 반이동 유입, 요일 지정, 휴원 표식 승계).
      --    GiST 충돌 시 이 서브트랜잭션만 롤백.
      --    🔑 `returning id` — 이 값이 있어야 되돌리기가 좌표 추측 없이 이 행만 정확히 지운다(0236a).
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days, on_hold)
        values (v_tenant, v_student, v_new_class, v_start, true, v_attend, coalesce(v_on_hold, false))
        returning id into v_new_id;

      v_results := v_results || jsonb_build_object(
        'enrollmentId', v_enr_id,
        'newEnrollmentId', v_new_id,
        'ok', true
      );
    exception when others then
      v_results := v_results
        || jsonb_build_object('enrollmentId', coalesce(v_enr_id::text, m->>'enrollmentId'),
                              'ok', false, 'error', sqlerrm);
    end;
  end loop;

  return v_results;
end;
$$;
