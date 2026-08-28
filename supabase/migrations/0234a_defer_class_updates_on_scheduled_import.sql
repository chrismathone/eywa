-- 예약 적용(미래 날짜)일 때 **담임·기본 강의실은 그날까지 안 바꾼다**(0231a 갱신).
--
-- 원장 2026-08-28: *"담임도 미래에 바뀌도록 해야겠는데"*. 배치(class_schedules)는 `valid_from`으로
-- 시간 축이 있는데 담임(`classes.teacher_id`)은 **반 단위 단일 값이라 축이 없어**, 예약 적용을 해도
-- 담임만 누르는 즉시 바뀌었다. 9월 개편을 8월에 넣어 두면 8월 남은 날들이 9월 담임으로 보인다.
--
-- 해법: 미래 적용이면 이 함수가 `classUpdates`를 **적용하지 않고 넘긴다**(payload엔 그대로 남는다).
-- 그날이 오면 cron(`/api/cron/apply-due-handovers`)이 스냅샷의 `classUpdates`를 적용한다.
--
-- 🔴 **인수인계(`pending_teacher_*`)에 얹지 않는 이유**: `applyHandover`는 담임 교체와 함께 그 반의
--    유효한 슬롯 담당도 옛 담임 → 새 담임으로 **옮긴다**(`moveLiveSlotTeacher`). 수학처럼 한 반을 한 사람이
--    다 가르치면 무해하지만 **영어는 요일·교시마다 담당이 다르다** — 가져오기가 이미 시트대로 정확히
--    넣어 둔 슬롯을 그 이동이 뭉갠다(월·수 Jane 슬롯이 Hannah로 끌려간다). 가져오기가 만든 예약은
--    슬롯이 이미 맞으므로 **담임 필드만** 바꿔야 한다.
-- 🔴 **컬럼을 추가하지 않는다**: 스냅샷 payload에 `classUpdates`(teacherId·prevTeacherId 포함)가 이미
--    통째로 들어 있어 그날 그대로 재생하면 된다. 새 컬럼을 만들면 SQL 적용 전에 앱이 배포되는 순간
--    인수인계 화면이 죽는다([[#95]]).
--
-- ⚠️ **이 SQL 적용 전에 앱이 먼저 배포돼도 안전하다**: 옛 함수는 종전대로 담임을 즉시 바꾸고,
--    cron은 "현재 담임이 아직 prevTeacherId일 때만" 적용하므로 이미 반영된 건은 조용히 건너뛴다.
--
-- ⚠️ 기본 강의실(`classroom_id`)도 같이 미룬다 — 같은 `classUpdates` 레코드라 갈라 두면 헷갈린다.
--    슬롯마다 `classroom_id`가 따로 있어 화면·출결은 그쪽을 보므로 미뤄도 손해가 없다.
-- ⚠️ 손수 alpha(drizzle 무관, 함수). db:generate 금지.

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
  v_deferred int := 0;
  rec        jsonb;
begin
  if v_tenant is null then
    raise exception 'apply_english_structure: 인증된 테넌트가 없습니다';
  end if;

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

  -- 1) 기존 처리 — 이미 시작된 행은 마감(valid_to = 기준일-1), 아직 시작 안 한 예약 행은 삭제(0231a).
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
      delete from public.class_schedules s
       where s.id = (rec->>'id')::uuid
         and s.tenant_id = v_tenant
         and s.valid_from >= p_today;
      if found then v_dropped := v_dropped + 1; end if;
    end if;
  end loop;

  -- 2) 신규 삽입: valid_from = 기준일, valid_to = 서버가 준 상한(더 늦은 예약이 있으면 그 전날, 0231a).
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

  -- 3) classes 담임/기본강의실 — 🔴 **미래 적용이면 지금 안 바꾼다**(그날 cron이 스냅샷을 재생한다).
  if p_today > current_date then
    select count(*)::int into v_deferred
      from jsonb_array_elements(coalesce(p_payload->'classUpdates', '[]'::jsonb));
  else
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
  end if;

  -- 4) 이력 로그(snapshot 참조).
  insert into public.timetable_import_logs (tenant_id, week_label, snapshot_id, result, details, actor_id)
  values (
    v_tenant, p_today::text, v_snapshot,
    jsonb_build_object('kind', 'english_structure', 'closed', v_closed, 'dropped', v_dropped,
                       'inserted', v_inserted, 'classUpdated', v_classupd,
                       'classUpdatesDeferred', v_deferred, 'summary', p_payload->'summary'),
    p_payload->'planItems', auth.uid()
  );

  return jsonb_build_object('snapshotId', v_snapshot, 'closed', v_closed, 'dropped', v_dropped,
                            'inserted', v_inserted, 'classUpdated', v_classupd,
                            'classUpdatesDeferred', v_deferred);
end;
$$;
