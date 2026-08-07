-- 0187a — `ecs_clear_present`가 **ECS가 스스로 넣은 유닛 자동값**은 지울 수 있게 (0169a 후속)
--
-- 0169a는 "출석부에서 사람이 손댄 기록은 ECS에서 못 지운다"를 `coalesce(session_units,1) = 1`로 표현했다.
-- 그 시절엔 ECS가 시수를 쓰지 않았으니 `≠1`은 곧 "사람이 적었다"였다.
-- 2026-08-06부터 ECS가 출결을 **처음 찍을 때 유닛 자동값**을 함께 넣는다(EiE=교시 수, 인재원=시간).
-- 그래서 그 조건이 더는 신호가 아니다 — 4교시 EiE 반은 만들자마자 `units=4`라 방금 잘못 누른 출석을
-- ECS에서 못 지우고, 게다가 *"출석부에서 사유·시수를 적어 둔 기록"* 이라는 **거짓 사유**가 뜬다.
--
-- 처방: 호출부가 **그 날의 자동값**(p_auto_units)을 함께 넘기고, 저장된 시수가 기본(1)이거나 **정확히 그
-- 자동값과 같을 때만** 지운다. 즉 *ECS가 넣은 그대로인 기록*은 되돌릴 수 있고, 사람이 다른 값으로 고쳤으면
-- 여전히 거절된다(0169a의 의도 보존). 사유(note)·상태 조건은 **그대로** — 그쪽이 사람이 남긴 진짜 신호다.
--
-- 🔴 시그니처가 바뀌므로 기존 함수를 drop하고 다시 만든다(오버로드를 남기면 PostgREST가 모호해진다).
-- ⚠️ p_auto_units를 안 넘기면(null) 0169a와 **완전히 동일**하게 동작한다 — 옛 호출부도 안전하다.
-- 롤백 = 0169a 본문으로 재생성(인자 5개).
set local statement_timeout = '60s';

drop function if exists public.ecs_clear_present(uuid, uuid, uuid, uuid, date);

create or replace function public.ecs_clear_present(
  p_tenant uuid, p_actor uuid, p_class uuid, p_student uuid, p_date date,
  p_auto_units numeric default null
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
  perform pg_advisory_xact_lock(
    hashtextextended('ecs-att|' || p_tenant::text || '|' || p_class::text || '|' || p_student::text || '|' || p_date::text, 42)
  );
  select
    count(*),
    count(*) filter (
      where a.status = 'present'::attendance_status
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
    and a.student_id = p_student and a.session_date = p_date;

  if v_total = 0 then
    -- 이미 없음 = 성공과 같은 최종상태(경쟁 시 양쪽 다 "취소됨"으로 수렴).
    return jsonb_build_object('cleared', 0, 'blocked', 'none');
  end if;
  if v_plain <> v_total then
    return jsonb_build_object('cleared', 0, 'blocked', 'rich');
  end if;

  delete from attendance_records a
  where a.tenant_id = p_tenant and a.class_id = p_class
    and a.student_id = p_student and a.session_date = p_date;
  get diagnostics v_deleted = row_count;
  -- p_actor는 감사 목적의 명시 인자(트리거가 service_role 호출에서 auth.uid()를 못 얻는다).
  return jsonb_build_object('cleared', v_deleted, 'blocked', null, 'actor', p_actor);
end;
$$;

revoke all on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric) from public, anon, authenticated;
grant execute on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric) to service_role;

comment on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric) is
  'ECS 출석 취소 — plain present(사유 없음 + 시수가 기본 1이거나 ECS 자동값 그대로)만 삭제. 사람이 고친 시수·사유가 붙었거나 결석·지각이면 거절. execute=service_role만.';

notify pgrst, 'reload schema';
