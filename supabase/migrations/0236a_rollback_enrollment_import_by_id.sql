-- 시간표 가져오기의 **학생 반이동 되돌리기 — 좌표가 아니라 id로**.
--
-- 🔴 왜(2026-08-29 적대 리뷰 codex·grok 합의, 0235a 주석의 나머지 절반): 0233a는 새로 생긴 수강을
--    `(student_id, class_id = toClassId, start_date = 적용일)` 좌표로 찾아 지우고, 옛 수강도
--    `end_date = 적용일`일 때만 재개방했다. 그 좌표는 **누구든 날짜나 반을 바꾸면 깨진다**:
--      · 대상 반이 바뀌면 → delete 0건 + 옛 수강만 재개방 = **이중 등록**(다른 반이라 GiST가 안 막는다)
--      · 적용일이 바뀌면 → delete·update 모두 0건 = **조용한 no-op**("모든 게 무로"가 거짓말)
--    `EditableDateCell`(학생 상세 수업 탭·반 상세 명단)이 지금도 그 날짜를 바꾸므로 재현 가능한 버그다.
--
-- 고침: 0235a가 `newEnrollmentId`를 결과에 실어 주고, 호출부(applyDiff)가 그걸 스냅샷 payload에 적는다.
-- 여기서는 **id가 있으면 id로** 지우고, 없으면 **옛 좌표로 폴백**한다.
--
-- 🔴 폴백을 남기는 이유: 이미 쌓인 스냅샷에는 `newEnrollmentId`가 없다. 폴백을 지우면 그 예약들의
--    취소가 통째로 죽는다(옛 데이터 호환 = [[#95]] expand/contract의 읽기 쪽).
-- ⚠️ id 경로에도 `tenant_id` 조건을 유지한다 — security invoker라 RLS가 이미 막지만, 이중격리는
--    0087a 이래 이 계열의 규약이다(admin 클라이언트로 부르는 날을 대비).
-- ⚠️ **미래 예약분만** 되돌린다(0233a와 동일) — 이미 시작된 이동은 그 사이 출결·보고서가 새 반에
--    붙었을 수 있어, 되돌리면 그 기록이 존재하지 않는 수강에 매달린다.
-- 멱등: 이미 되돌린 뒤 다시 불러도 0건 처리.
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
  v_new_id   uuid;
  v_n        int;
  v_skipped  int := 0;
  -- 🔴 `current_date`를 쓰지 말 것 — **이 DB의 timezone은 UTC다**(0220a·0124a와 같은 함정).
  --    KST 00~09시엔 하루 어긋나, "아직 시작 안 함"을 오늘 시작한 행에까지 적용해 지워 버린다.
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
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
  if v_eff is null or v_eff <= v_today then
    raise exception '이미 시작된 반이동은 되돌릴 수 없습니다(적용일 %). 미래 예약분만 취소할 수 있습니다', v_eff;
  end if;

  -- ① moves — 새로 생긴 수강 삭제 → 옛 수강 재개방. 순서를 바꾸면 겹침 제약에 걸릴 수 있다.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'moves', '[]'::jsonb)) as t(value)
  loop
    v_new_id := nullif(rec->>'newEnrollmentId','')::uuid;
    v_n := 0;
    if v_new_id is not null then
      -- 🔑 id 경로 — 그 사이 누가 날짜·반을 바꿨어도 **바로 그 행**을 지운다.
      -- 🔴 단 **아직 시작 안 한 행만**. 옛 좌표 경로는 `start_date = v_eff`(미래)라 이 보호가 공짜로
      --    있었는데, id로 바꾸면서 사라졌다. 누가 시작일을 오늘 이전으로 당겨 놓았으면 그 사이 출결이
      --    붙었을 수 있어, 지우면 기록이 존재하지 않는 수강에 매달린다(이 함수의 전제와 같은 이유).
      delete from public.enrollments
       where id = v_new_id and tenant_id = v_tenant and start_date > v_today;
      get diagnostics v_n = row_count;
      -- 🔴 못 지웠는데 **행이 아직 살아 있으면** 옛 수강도 건드리지 않는다 — 한쪽만 되돌리면
      --    (옛 반 재개방 + 새 반 잔존) 그 학생이 두 반에 동시에 있게 된다. 둘 다 되돌리거나 둘 다 둔다.
      if v_n = 0 and exists (
        select 1 from public.enrollments where id = v_new_id and tenant_id = v_tenant
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    else
      -- 폴백(옛 스냅샷) — 좌표 추측. 날짜·반이 바뀌었으면 못 찾는다(그래서 id를 쓰게 된 것).
      select student_id into v_student
        from public.enrollments
       where id = (rec->>'enrollmentId')::uuid and tenant_id = v_tenant;
      if v_student is not null then
        delete from public.enrollments
         where tenant_id = v_tenant
           and student_id = v_student
           and class_id = (rec->>'toClassId')::uuid
           and start_date = v_eff;
        get diagnostics v_n = row_count;
      end if;
    end if;
    v_deleted := v_deleted + v_n;

    -- 옛 수강 재개방 — 🔑 `end_date = v_eff` 조건을 걸지 않는다(누가 종료일을 옮겼어도 되돌려야 한다).
    -- 🔴 대신 **이 import가 남긴 흔적일 때만** 되돌린다(사유 '반 이동' + is_transferred). 그 사이 진짜
    --    퇴원 처리된 학생을 되살리면 없던 재원생이 생긴다 — 되돌리기가 만들어서는 안 되는 사실이다.
    update public.enrollments
       set end_date = null,
           is_transferred = false,
           withdrawal_reason = null
     where id = (rec->>'enrollmentId')::uuid
       and tenant_id = v_tenant
       and end_date is not null
       and is_transferred = true
       and withdrawal_reason = '반 이동';
    get diagnostics v_n = row_count;
    v_reopened := v_reopened + v_n;
  end loop;

  -- ② removes — 적용 때 닫은 종료일을 비운다. 사유도 이 import가 남긴 것일 때만 지운다.
  --    🔑 종료일 값은 안 따진다(옮겨졌을 수 있다). 사유가 이 import의 것인지가 진짜 판별 근거다.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'removes', '[]'::jsonb)) as t(value)
  loop
    update public.enrollments
       set end_date = null,
           withdrawal_reason = null
     where id = (rec->>'enrollmentId')::uuid
       and tenant_id = v_tenant
       and end_date is not null
       and withdrawal_reason = '엑셀 import 삭제';
    get diagnostics v_n = row_count;
    v_reopened := v_reopened + v_n;
  end loop;

  -- ③ adds — 그 날부터 시작할 예정이던 수강 삭제. id가 있으면 id로.
  for rec in select value from jsonb_array_elements(coalesce(v_diff->'adds', '[]'::jsonb)) as t(value)
  loop
    v_new_id := nullif(rec->>'enrollmentId','')::uuid;
    if v_new_id is not null then
      -- moves와 같은 이유로 **아직 시작 안 한 행만** 지운다.
      delete from public.enrollments
       where id = v_new_id and tenant_id = v_tenant and start_date > v_today;
      get diagnostics v_n = row_count;
      -- 🔴 moves와 **같은 집계**를 해야 한다 — 여기만 빼면 못 지운 행이 `skipped=0`으로 묻혀
      --    호출부가 "전부 되돌렸다"고 말한다(부분 취소가 침묵한다).
      if v_n = 0 and exists (
        select 1 from public.enrollments where id = v_new_id and tenant_id = v_tenant
      ) then
        v_skipped := v_skipped + 1;
      end if;
    else
      delete from public.enrollments
       where tenant_id = v_tenant
         and student_id = (rec->>'studentId')::uuid
         and class_id = (rec->>'classId')::uuid
         and start_date = v_eff;
      get diagnostics v_n = row_count;
    end if;
    v_deleted := v_deleted + v_n;
  end loop;

  -- 🔴 **완전히 되돌렸을 때만** 복원 표식을 찍는다. 부분 취소에도 찍으면 그 스냅샷이 예약 목록에서
  --    빠져(scheduled-import-queries가 restored_at을 제외한다) **다시 취소할 길이 사라진다** —
  --    남은 행은 그대로인데 화면엔 "예약 없음"으로 보인다.
  if v_skipped = 0 then
    update public.timetable_import_logs
       set restored_at = now()
     where snapshot_id = p_snapshot_id and tenant_id = v_tenant and restored_at is null;
  end if;

  -- `skipped` = 이미 시작돼 손대지 않은 건수. 0이 아니면 취소가 **부분적**이라 호출부가 알려야 한다.
  return jsonb_build_object(
    'deleted', v_deleted, 'reopened', v_reopened, 'skipped', v_skipped, 'effectiveDate', v_eff
  );
end;
$$;
