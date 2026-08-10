-- 0197a — ECS 출석 취소('선택 안 함')를 **교시 단위**로 (0196a·0187a 후속)
--
-- 0196a로 출결에 교시(slot_start)가 생겼는데, 취소 RPC는 아직 (반·학생·날짜) 전부를 지운다.
-- 그대로 두고 ECS를 교시별로 켜면 **4교시 하나를 취소했는데 6교시 기록까지 사라진다** — 그래서
-- 이 SQL과 ECS 배선은 반드시 **함께** 나가야 한다(SQL 먼저 적용, 앱은 그 다음).
--
-- 판정은 `is not distinct from`을 쓴다 — `= null`은 항상 unknown이라 옛 기록(slot_start null)을
-- 영원히 못 지우게 된다. 이 연산자는 null끼리도 '같다'로 본다.
--   · p_slot = '16:20'  → 그 교시 행만
--   · p_slot = null     → **"그날 전체" 행(slot_start null)만** — 다른 교시는 안 건드린다.
--
-- ⚠️ 옛 앱(인자 6개, 이름 지정 호출)도 그대로 돈다 — p_slot이 default null이고, 지금 DB의 출결은
--    6,540행 전부 slot_start가 null이라 **동작이 지금과 완전히 동일**하다(적용해도 화면 무변화).
-- 🔴 오버로드를 남기면 PostgREST가 "함수가 모호하다"로 400을 낸다 → 기존 6-인자 함수를 drop하고
--    7-인자로 다시 만든다(0187a가 5→6으로 갈 때와 같은 이유).
-- ⚠️ 사유(note)·상태·시수 조건은 0187a 그대로다 — 사람이 손댄 기록은 여전히 ECS에서 못 지운다.
--
-- 롤백 = 0187a 본문으로 재생성(인자 6개).
set local statement_timeout = '60s';

drop function if exists public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric);

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

comment on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date, numeric, time) is
  'ECS 출석 취소 — 그 교시(p_slot, null=그날 전체 행)의 plain present만 삭제. 사람이 고친 시수·사유가 붙었거나 결석·지각이면 거절. execute=service_role만.';

notify pgrst, 'reload schema';
