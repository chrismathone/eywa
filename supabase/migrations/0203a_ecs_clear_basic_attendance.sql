-- 0203a — ECS '선택 안 함'을 **지각·결석까지** (0169a·0187a·0197a 후속, 원장 2026-08-11)
--
-- 원장이 출결을 체크 순환으로 바꾸라고 했다: *"체크할때마다 출석 → 결석 → 지각 → 선택안함으로 반복."*
-- 그런데 지금 취소 함수는 **`status = 'present'`인 행만** '손 안 댄 기록'으로 쳐서, 지각·결석에 닿으면
-- 순환의 마지막 칸(선택 안 함)이 영영 안 열린다 = **오클릭한 결석에서 빠져나올 길이 화면에 없다**
-- (gotcha #103이 말하는 "되돌릴 문을 잠그지 말 것"의 정확한 재현).
--
-- 이 규칙은 ECS가 present만 만들 수 있던 시절(0169a)에 쓰였다. 2026-08-06부터 ECS는 결석·지각도
-- 직접 만든다 — 자기가 만든 기록을 자기가 못 지우는 상태였던 셈이다.
--
-- **넓히는 것은 상태뿐이다.** '손 안 댄 기록' 판정의 나머지 두 조건은 그대로다:
--   · 사유(note)가 비어 있을 것 — 사람이 적은 문장은 여기서 안 지운다.
--   · 시수(session_units)가 기본(1)이거나 그 시절 자동값(p_auto_units) 그대로일 것 — 손으로 고친
--     시수는 급여에 닿으므로 여기서 안 지운다.
-- 즉 **사유·시수가 붙은 기록은 여전히 출석부에서만** 지울 수 있다(0169a의 취지 보존).
--
-- ⚠️ 시그니처가 같아 `create or replace`다(drop 불필요 → PostgREST 오버로드 모호성 위험 없음).
-- 되돌리기 = 0197a 본문 그대로 다시 실행(status = 'present' 조건 복원).
set local statement_timeout = '60s';

create or replace function public.ecs_clear_present(
  p_tenant uuid, p_actor uuid, p_class uuid, p_student uuid, p_date date,
  p_auto_units numeric default null,
  p_slot time default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total int;
  v_plain int;
  v_deleted int;
begin
  -- 잠금 키에 교시를 넣는다 — 같은 학생의 다른 교시를 동시에 취소해도 서로 기다리지 않는다.
  perform pg_advisory_xact_lock(
    hashtextextended(
      'ecs-att|' || p_tenant::text || '|' || p_class::text || '|' || p_student::text || '|'
        || p_date::text || '|' || coalesce(p_slot::text, '-'),
      42)
  );
  select
    count(*),
    count(*) filter (
      -- 0203a: present뿐 아니라 **ECS가 만들 수 있는 3종 전부**. 조퇴·공결·보강은 여기서 안 지운다
      -- (출석부에서만 만들 수 있는 상태라, 지울 수 있게 하면 ECS가 모르는 사이에 없앨 수 있다).
      where a.status in ('present'::attendance_status, 'late'::attendance_status, 'absent'::attendance_status)
        and (a.note is null or btrim(a.note) = '')
        -- 기본(1) 또는 **ECS가 넣은 자동값 그대로**인 것만 '손 안 댄 기록'으로 본다.
        and (
          coalesce(a.session_units, 1) = 1
          or (p_auto_units is not null and a.session_units = p_auto_units)
        )
    )
    into v_total, v_plain
  from attendance_records a
  where a.tenant_id = p_tenant and a.class_id = p_class
    and a.student_id = p_student and a.session_date = p_date
    and a.slot_start is not distinct from p_slot;

  if v_total = 0 then
    -- 이미 없음 = 성공과 같은 최종상태(경쟁 시 양쪽 다 "취소됨"으로 수렴).
    return jsonb_build_object('cleared', 0, 'blocked', 'none');
  end if;
  if v_plain <> v_total then
    return jsonb_build_object('cleared', 0, 'blocked', 'rich');
  end if;

  delete from attendance_records a
  where a.tenant_id = p_tenant and a.class_id = p_class
    and a.student_id = p_student and a.session_date = p_date
    and a.slot_start is not distinct from p_slot;
  get diagnostics v_deleted = row_count;
  -- p_actor는 감사 목적의 명시 인자(트리거가 service_role 호출에서 auth.uid()를 못 얻는다).
  return jsonb_build_object('cleared', v_deleted, 'blocked', null, 'actor', p_actor);
end;
$$;

revoke all on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric, time) from public, anon, authenticated;
grant execute on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric, time) to service_role;
