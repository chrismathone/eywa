-- 반 이동이 **휴원 표식(on_hold)을 승계**한다 — 휴원 학생을 반 이동시키면 조용히 활성이 되던 것.
--
-- 배경(원장 2026-08-20 *"합리적이 될 수 있도록 휴원 해결해야겠어"*): 휴원 처리는
-- `students.status='on_hold'` **＋ 열린 수강 전부 `on_hold=true`** 두 곳을 바꾼다. 그런데 이 RPC의
-- insert가 `(tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days)`만 넣어
-- **on_hold가 기본값 false로 새로 생겼다** → 학생은 휴원인데 옮겨간 반에서는 활성. 출석부·원스크린·
-- 좌석표 로스터는 전부 **수강의 on_hold**로 거르고 학생 상태는 안 보므로, 학생목록엔 휴원인 아이가
-- 출석부엔 그대로 뜬다(같은 구멍이 `createEnrollment`에도 있었고 그쪽은 앱에서 재원 학생만 배정하도록 막았다).
--
-- 0063a(attendance_days 판)를 대체 — **그 파일은 고치지 않고** 전체 정의를 여기 다시 쓴다.
-- 변경은 두 줄뿐이다: 옛 수강에서 `on_hold`를 함께 읽고(v_on_hold), 새 행 insert에 그대로 싣는다.
-- 🔴 **호출부 변경 0** — 앱은 이 마이그레이션 적용 전에도 그대로 돈다(옛 함수는 on_hold를 안 옮길 뿐, [[#95]]).
-- SECURITY INVOKER·per-move 서브트랜잭션·RLS(tenant_isolation)는 0063a와 동일.
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
  v_on_hold    boolean;
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

      -- 2) 새 반에 등록(적용일 시작, 반이동 유입, 요일 지정, **휴원 표식 승계**).
      --    GiST 충돌 시 이 서브트랜잭션만 롤백.
      insert into public.enrollments
        (tenant_id, student_id, class_id, start_date, is_transferred_in, attendance_days, on_hold)
        values (v_tenant, v_student, v_new_class, v_start, true, v_attend, coalesce(v_on_hold, false));

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
