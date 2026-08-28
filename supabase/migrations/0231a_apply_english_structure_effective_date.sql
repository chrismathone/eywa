-- 영어 시트 구조 import를 **미래 날짜로 예약 적용**할 수 있게 되면서 생기는 세 구멍을 막는다(0087a 갱신).
-- 원장 2026-08-28: *"선택하는 날짜에 넣게 하는 기능이 필요해."*
--
-- 함수 시그니처는 그대로다(`p_today`는 0087a부터 있었고, 서버 액션이 이제 오늘 대신 **적용일**을 넘긴다).
-- 그래서 이 SQL을 적용하기 전에 앱이 먼저 배포돼도 죽지 않는다([[#95]] expand/contract) — 옛 함수로도
-- 예약 적용은 동작하고, payload에 늘어난 키(`validTo`)는 조용히 무시된다. 미적용 구간에 남는 차이는
-- 아래 ①의 쓰레기 행과 ③의 중복뿐이고, ③은 영어에 해당 행이 0건이라 실제로 발생하지 않는다.
--
-- ① **아직 시작 안 한 행을 마감하면 거꾸로 된 구간이 된다.**
--    예약 적용(9/7)을 한 뒤 시트를 고쳐 **같은 날짜로 다시** 가져오면, 9/7부터 유효한 행이 마감 대상이 된다.
--    옛 코드는 그것도 `valid_to = 기준일-1`로 닫아 `valid_from(9/7) > valid_to(9/6)`인 행을 남겼다 —
--    `slotLiveOnDate`가 어느 날짜로도 통과시키지 않아 **어디서도 안 보이는 쓰레기**가 쌓인다.
--    한 번도 유효한 적 없는 예약 행은 '이력'이 아니라 **취소 대상**이므로 마감이 아니라 **삭제**한다.
--    ⚠️ 이미 시작된 행(valid_from < 기준일)은 지금처럼 마감한다 — 그건 실제로 있었던 배치라 지우면 안 된다.
--
-- ② 그래서 롤백도 **삭제분을 되살릴 수 있어야** 한다. 스냅샷 `payload.before`에 마감 대상 행의 전체 모습이
--    이미 통째로 들어 있으므로(0087a), 되돌릴 때 "before에는 있는데 지금 없는 id"를 그대로 다시 넣는다.
--
-- ③ **더 늦은 날짜로 이미 예약된 배치가 있으면 새 행을 무기한으로 열면 안 된다.** 9/14 예약이 있는 칸에
--    9/7로 적용하면, 새 행(9/7~∞)과 예약 행(9/14~∞)이 9/14부터 **둘 다** 살아 같은 칸이 두 번 그려진다.
--    서버가 `inserts[].validTo`(= 예약 시작일 −1)를 실어 보내고 이 함수가 그대로 쓴다 — 두 계획이 모두 산다.
--    (실측 2026-08-28: 영어 슬롯 중 미래 시작 행은 0건이고 7건 전부 math 특강이라, 지금 당장 걸릴 일은 없다.)
--
-- security invoker·auth_tenant_id() 이중격리·멱등(create or replace)은 0087a 그대로.
-- ⚠️ 손수 alpha(drizzle 무관, 함수). db:generate 금지.

-- ── 적용 ──────────────────────────────────────────────────────────────────────
create or replace function public.apply_english_structure(
  p_payload jsonb,
  p_today   date default current_date
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_snapshot uuid;
  v_before   jsonb;
  v_closed   int := 0;
  v_dropped  int := 0;
  v_inserted int := 0;
  v_classupd int := 0;
  rec        jsonb;
begin
  if v_tenant is null then
    raise exception 'apply_english_structure: 인증된 테넌트가 없습니다';
  end if;

  -- before 스냅샷: 마감/삭제 대상(closes[].id) 기존 스케줄 전체 행 — 롤백 복원 원천.
  select coalesce(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb)
    into v_before
    from public.class_schedules s
   where s.tenant_id = v_tenant
     and s.id in (
       select (x->>'id')::uuid
         from jsonb_array_elements(coalesce(p_payload->'closes', '[]'::jsonb)) x
     );

  insert into public.timetable_snapshots (tenant_id, label, reference_date, summary, payload, created_by)
  values (
    v_tenant,
    coalesce(p_payload->>'label', '영어 시트 구조 import'),
    p_today,
    p_payload->'summary',
    jsonb_build_object('kind', 'english_structure', 'today', p_today, 'before', v_before, 'apply', p_payload),
    auth.uid()
  )
  returning id into v_snapshot;

  -- 1) 기존 처리 — **이미 시작된 행은 마감**(valid_to = 기준일-1), **아직 시작 안 한 예약 행은 삭제**.
  --    이미 마감된 행(valid_to < 기준일)은 건드리지 않는다(멱등).
  for rec in
    select value from jsonb_array_elements(coalesce(p_payload->'closes', '[]'::jsonb)) as t(value)
  loop
    update public.class_schedules s
       set valid_to = p_today - 1
     where s.id = (rec->>'id')::uuid
       and s.tenant_id = v_tenant
       and s.valid_from < p_today
       and (s.valid_to is null or s.valid_to >= p_today);
    if found then
      v_closed := v_closed + 1;
    else
      -- 한 번도 유효한 적 없는 행(valid_from >= 기준일) = 지난 예약분. 마감하면 거꾸로 된 구간이 된다.
      delete from public.class_schedules s
       where s.id = (rec->>'id')::uuid
         and s.tenant_id = v_tenant
         and s.valid_from >= p_today;
      if found then v_dropped := v_dropped + 1; end if;
    end if;
  end loop;

  -- 2) 신규 삽입: valid_from = 기준일. id는 서버 생성(롤백 식별). class_id는 RLS+FK로 본 테넌트 강제.
  --    `validTo`는 평소 null(무기한)이지만, **같은 칸에 더 늦은 날짜로 예약된 배치가 있으면** 서버가 그
  --    하루 전을 실어 보낸다 — 안 닫으면 그 예약일부터 옛/새 행이 둘 다 살아 같은 칸이 두 번 그려진다.
  for rec in
    select value from jsonb_array_elements(coalesce(p_payload->'inserts', '[]'::jsonb)) as t(value)
  loop
    insert into public.class_schedules (
      id, tenant_id, class_id, day_of_week, start_time, end_time,
      valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label
    )
    values (
      (rec->>'id')::uuid, v_tenant, (rec->>'classId')::uuid,
      (rec->>'day')::day_of_week, (rec->>'startTime')::time, nullif(rec->>'endTime', '')::time,
      p_today, nullif(rec->>'validTo', '')::date,
      nullif(rec->>'teacherId', '')::uuid, nullif(rec->>'classroomId', '')::uuid,
      nullif(rec->>'slotTeacherLabel', ''), nullif(rec->>'slotRoomLabel', '')
    );
    v_inserted := v_inserted + 1;
  end loop;

  -- 3) classes 담임/기본강의실 — 해석된 값만(null 덮어쓰기 금지).
  --    ⚠️ 이건 시간 축이 없는 값이라 **예약 적용이어도 지금 바뀐다**(담임은 반 단위 단일 값).
  --    지난 주 담임 복원은 감사로그 기반(`teacher-as-of.ts`)이라 이 즉시 반영과 충돌하지 않는다.
  for rec in
    select value from jsonb_array_elements(coalesce(p_payload->'classUpdates', '[]'::jsonb)) as t(value)
  loop
    update public.classes c
       set teacher_id   = coalesce(nullif(rec->>'teacherId', '')::uuid,   c.teacher_id),
           classroom_id = coalesce(nullif(rec->>'classroomId', '')::uuid, c.classroom_id)
     where c.id = (rec->>'classId')::uuid
       and c.tenant_id = v_tenant
       and c.subject = 'english';
    if found then v_classupd := v_classupd + 1; end if;
  end loop;

  -- 4) 이력 로그(snapshot 참조).
  insert into public.timetable_import_logs (tenant_id, week_label, snapshot_id, result, details, actor_id)
  values (
    v_tenant, p_today::text, v_snapshot,
    jsonb_build_object('kind', 'english_structure', 'closed', v_closed, 'dropped', v_dropped,
                       'inserted', v_inserted, 'classUpdated', v_classupd, 'summary', p_payload->'summary'),
    p_payload->'planItems', auth.uid()
  );

  return jsonb_build_object('snapshotId', v_snapshot, 'closed', v_closed, 'dropped', v_dropped,
                            'inserted', v_inserted, 'classUpdated', v_classupd);
end;
$$;

-- ── 롤백 ──────────────────────────────────────────────────────────────────────
-- 순서: 삽입행 삭제 → 마감행 valid_to 복원 → **삭제된 예약행 되살리기** → classes prev 복원.
create or replace function public.rollback_english_structure(p_snapshot_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_apply    jsonb;
  v_before   jsonb;
  v_deleted  int := 0;
  v_restored int := 0;
  v_classrev int := 0;
  rec        jsonb;
begin
  if v_tenant is null then
    raise exception 'rollback_english_structure: 인증된 테넌트가 없습니다';
  end if;

  select payload->'apply', coalesce(payload->'before', '[]'::jsonb)
    into v_apply, v_before
    from public.timetable_snapshots
   where id = p_snapshot_id and tenant_id = v_tenant
     and payload->>'kind' = 'english_structure';
  if v_apply is null then
    raise exception 'rollback_english_structure: 스냅샷을 찾을 수 없습니다(또는 대상 아님)';
  end if;

  -- 1) 삽입행 삭제(id 타겟, 테넌트 격리).
  for rec in select value from jsonb_array_elements(coalesce(v_apply->'inserts', '[]'::jsonb)) as t(value)
  loop
    delete from public.class_schedules
     where id = (rec->>'id')::uuid and tenant_id = v_tenant;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;

  -- 2) 마감행 valid_to 복원(적용 때 기준일-1로 닫은 것을 이전 값으로).
  for rec in select value from jsonb_array_elements(coalesce(v_apply->'closes', '[]'::jsonb)) as t(value)
  loop
    update public.class_schedules
       set valid_to = nullif(rec->>'prevValidTo', '')::date
     where id = (rec->>'id')::uuid and tenant_id = v_tenant;
    if found then v_restored := v_restored + 1; end if;
  end loop;

  -- 3) 삭제된 예약행 되살리기 — before에는 있는데 지금 없는 id(위 ①의 delete 분).
  --    ⚠️ 1)의 삽입행 삭제가 먼저라 같은 (반·요일·시각) 자리에 부딪히지 않는다.
  for rec in select value from jsonb_array_elements(v_before) as t(value)
  loop
    if (rec->>'tenant_id')::uuid = v_tenant
       and not exists (
         select 1 from public.class_schedules
          where id = (rec->>'id')::uuid and tenant_id = v_tenant
       )
    then
      insert into public.class_schedules
      select r.* from jsonb_populate_record(null::public.class_schedules, rec) r;
      v_restored := v_restored + 1;
    end if;
  end loop;

  -- 4) classes 복원 — 필드 독립, 적용된 필드만, 현재 값이 적용값과 같을 때만(이후 수동변경 보호).
  for rec in select value from jsonb_array_elements(coalesce(v_apply->'classUpdates', '[]'::jsonb)) as t(value)
  loop
    if rec->>'teacherId' is not null then
      update public.classes c
         set teacher_id = nullif(rec->>'prevTeacherId', '')::uuid
       where c.id = (rec->>'classId')::uuid and c.tenant_id = v_tenant
         and c.teacher_id is not distinct from (rec->>'teacherId')::uuid;
      if found then v_classrev := v_classrev + 1; end if;
    end if;
    if rec->>'classroomId' is not null then
      update public.classes c
         set classroom_id = nullif(rec->>'prevClassroomId', '')::uuid
       where c.id = (rec->>'classId')::uuid and c.tenant_id = v_tenant
         and c.classroom_id is not distinct from (rec->>'classroomId')::uuid;
      if found then v_classrev := v_classrev + 1; end if;
    end if;
  end loop;

  update public.timetable_import_logs
     set restored_at = now()
   where snapshot_id = p_snapshot_id and tenant_id = v_tenant and restored_at is null;

  return jsonb_build_object('deleted', v_deleted, 'restored', v_restored, 'classReverted', v_classrev);
end;
$$;
