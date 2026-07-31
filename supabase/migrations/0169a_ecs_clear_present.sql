-- 0169a: ECS 출석 **취소**(체크 해제) — 0157a §E "비파괴(생성만)" 계약의 명시적 완화.
--
-- 배경: ECS 로스터의 출석 체크는 생성만 되고 되돌릴 수 없었다(오클릭 = /attendance 권한자만 정리 가능).
-- 원장 지시 2026-07-31: "출석을 다시 누르면 출석 취소할 수 있게" → 같은 버튼 토글.
--
-- 🔴 취소는 **ECS가 만들 수 있었던 모양의 기록에만** 허용한다(plain present):
--    그 (반·학생·날짜)의 모든 행이 status='present' + note 없음 + session_units 기본(1).
--    하나라도 결석/지각/공결이거나 메모·시수 배수가 붙어 있으면 **거부**하고 출석부로 보낸다 —
--    그쪽 값은 출석부에서 사람이 사유·시수까지 적어 넣은 기록이고, 시수 검증(0103a/0115a)과
--    급여 분배(0117a)가 그 배수를 읽는다. ECS의 체크박스 한 번으로 지울 수 있는 데이터가 아니다.
--
-- 삭제 자체는 /attendance의 '지우기'(status=null 경로)와 같은 의미 — 그 (반·학생·날짜) 행 전부 제거.
-- attendance_records에는 활동로그 트리거(0084a: after insert **or delete**)가 붙어 있어 취소도 로그에 남고,
-- 액션 계층이 audit_logs(ecs_attendance_clear)에 "누가 취소했는지"를 추가로 남긴다(트리거는 service_role
-- 호출이라 actor가 null이다).
--
-- 락 키는 0157a의 mark 함수와 **동일**(같은 학생·날짜의 체크/해제가 서로 직렬화되게).
-- 롤백 = drop function public.ecs_clear_present(uuid, uuid, uuid, uuid, date);

create or replace function public.ecs_clear_present(
  p_tenant uuid, p_actor uuid, p_class uuid, p_student uuid, p_date date
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
        and coalesce(a.session_units, 1) = 1
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

-- 0157a §11과 동일한 정밀 revoke/grant — service_role만 execute.
revoke all on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date) to service_role;

comment on function public.ecs_clear_present(uuid, uuid, uuid, uuid, date) is
  'ECS 출석 취소 — 그 (반·학생·날짜) 기록이 전부 plain present(메모·시수 없음)일 때만 삭제, 아니면 blocked=rich로 거부. execute=service_role만.';

notify pgrst, 'reload schema';
