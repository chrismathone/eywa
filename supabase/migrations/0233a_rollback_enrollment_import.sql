-- 시간표 가져오기의 **학생 반이동**을 되돌린다 — 미래 적용 예약분 한정.
--
-- 원장 2026-08-28: *"라벨 옆에 x가 있어서 적용 취소를 할 수 있게 하는거지. 그럼 모든게 무로 돌아가는거야.
-- 마치 아무것도 안한것처럼"*. 배치(class_schedules)는 `rollback_english_structure`(0087a·0231a)가 이미
-- 되돌리는데 **반이동(enrollments)은 되돌리는 길이 없었다** — 다이얼로그의 되돌리기 버튼도 배치만 다룬다.
-- 그래서 "모든게 무로"가 성립하지 않았다.
--
-- 🔴 **미래 예약분만** 되돌린다(`reference_date > current_date`일 때만). 이미 시작된 반이동은 그 사이
--    출결·수업보고서가 새 반에 붙었을 수 있어, 되돌리면 그 기록이 존재하지 않는 수강에 매달린다.
--    아직 시작 안 한 예약은 **아무 일도 일어나지 않은 상태**라 지우는 것이 정확히 원상복구다.
--
-- 되돌리는 방법(스냅샷 payload = applyDiff가 저장한 ImportDiff):
--   · adds    … (학생·반·시작일=적용일) 수강을 **삭제**  — 그 날부터 시작할 예정이었던 것
--   · removes … 종료일을 **비운다**(적용 때 end_date=적용일로 닫았다). loadContext가 `end_date is null`인
--                행만 가져오므로 이전 값은 언제나 null이었다.
--   · moves   … 새로 생긴 수강을 **삭제**한 뒤 옛 수강의 종료일을 비운다(순서 중요 — 겹침 제약 회피).
--
-- security invoker + auth_tenant_id() 이중격리(0087a 패턴). 멱등: 이미 되돌린 뒤 다시 불러도 0건 처리.
-- ⚠️ 손수 alpha(drizzle 무관, 함수). db:generate 금지.

create or replace function public.rollback_enrollment_import(p_snapshot_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_diff     jsonb;
  v_eff      date;
  v_deleted  int := 0;
  v_reopened int := 0;
  rec        jsonb;
  v_student  uuid;
begin
  if v_tenant is null then
    raise exception 'rollback_enrollment_import: 인증된 테넌트가 없습니다';
  end if;

  select payload, reference_date into v_diff, v_eff
    from public.timetable_snapshots
   where id = p_snapshot_id and tenant_id = v_tenant;
  if v_diff is null then
    raise exception 'rollback_enrollment_import: 스냅샷을 찾을 수 없습니다';
  end if;
  -- 배치 스냅샷(kind=english_structure)은 전용 함수가 따로 있다 — 여기로 오면 안 된다.
  if v_diff ? 'kind' then
    raise exception 'rollback_enrollment_import: 반이동 스냅샷이 아닙니다';
  end if;
  if v_eff is null or v_eff <= current_date then
    raise exception '이미 시작된 반이동은 되돌릴 수 없습니다(적용일 %). 미래 예약분만 취소할 수 있습니다', v_eff;
  end if;

  -- ① moves — 새로 생긴 수강 삭제 → 옛 수강 재개방. 순서를 바꾸면 겹침 제약에 걸릴 수 있다.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'moves', '[]'::jsonb)) as t(value)
  loop
    select student_id into v_student
      from public.enrollments
     where id = (rec->>'enrollmentId')::uuid and tenant_id = v_tenant;
    if v_student is not null then
      delete from public.enrollments
       where tenant_id = v_tenant
         and student_id = v_student
         and class_id = (rec->>'toClassId')::uuid
         and start_date = v_eff;
      if found then v_deleted := v_deleted + 1; end if;
    end if;
    update public.enrollments
       set end_date = null
     where id = (rec->>'enrollmentId')::uuid and tenant_id = v_tenant and end_date = v_eff;
    if found then v_reopened := v_reopened + 1; end if;
  end loop;

  -- ② removes — 적용 때 닫은 종료일을 비운다. 사유도 이 import가 남긴 것일 때만 지운다.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'removes', '[]'::jsonb)) as t(value)
  loop
    update public.enrollments
       set end_date = null,
           withdrawal_reason = case when withdrawal_reason = '엑셀 import 삭제' then null else withdrawal_reason end
     where id = (rec->>'enrollmentId')::uuid and tenant_id = v_tenant and end_date = v_eff;
    if found then v_reopened := v_reopened + 1; end if;
  end loop;

  -- ③ adds — 그 날부터 시작할 예정이던 수강 삭제.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'adds', '[]'::jsonb)) as t(value)
  loop
    delete from public.enrollments
     where tenant_id = v_tenant
       and student_id = (rec->>'studentId')::uuid
       and class_id = (rec->>'classId')::uuid
       and start_date = v_eff;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;

  update public.timetable_import_logs
     set restored_at = now()
   where snapshot_id = p_snapshot_id and tenant_id = v_tenant and restored_at is null;

  return jsonb_build_object('deleted', v_deleted, 'reopened', v_reopened, 'effectiveDate', v_eff);
end;
$$;
