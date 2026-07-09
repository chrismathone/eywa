-- 영어 강사별 시트 → class_schedules 구조 import "적용/롤백" RPC (원자 트랜잭션).
-- 배경: 미리보기(previewStructureImport)로 확인한 변경 계획을 DB에 반영한다. 서버 액션
-- (applyStructureImport)이 시트+DB를 재읽어 diff를 재계산하고 hash로 대조한 뒤, 그 결과를
-- p_payload로 넘겨 이 RPC가 원자적으로 실행한다(스냅샷→마감→삽입→classes 갱신→로그를 한 트랜잭션).
-- 클라가 넘긴 계획을 신뢰하지 않는다: 진실은 서버 재계산, 이 RPC는 그 결과의 원자 실행기.
--
-- temporal 모델(apply-english-schedules.cjs 계승): 변경 슬롯은 기존 행 valid_to=오늘-1로 마감 +
-- 신규 행 valid_from=오늘 삽입 → fetchSlots(valid_from<=주일요일 AND (valid_to null OR >=오늘))와 정합,
-- 타임머신 과거 주 이력 보존. 신규 행 id는 서버가 생성해 넘겨 롤백 식별에 사용.
--
-- security invoker(0039a/0040a/0077a 패턴): PostgREST authenticated 세션으로 호출 → 내부 쓰기에
-- 각 테이블 RLS가 그대로 적용 + auth_tenant_id() where 이중격리. tenant + subject='english' 스코프
-- 밖은 절대 안 건드림(수학 불가침).
--
-- ⚠️ 손수 alpha(drizzle 무관, 함수). 멱등(create or replace). db:generate 금지.
--   적용: node --env-file=.env.local -e "raw exec" 또는 supabase db push.

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
  v_inserted int := 0;
  v_classupd int := 0;
  rec        jsonb;
begin
  if v_tenant is null then
    raise exception 'apply_english_structure: 인증된 테넌트가 없습니다';
  end if;

  -- before 스냅샷: 마감 대상(closes[].id) 기존 스케줄 전체 행 — 롤백 복원 원천.
  select coalesce(jsonb_agg(to_jsonb(s.*)), '[]'::jsonb)
    into v_before
    from public.class_schedules s
   where s.tenant_id = v_tenant
     and s.id in (
       select (x->>'id')::uuid
         from jsonb_array_elements(coalesce(p_payload->'closes', '[]'::jsonb)) x
     );

  -- 스냅샷 insert (payload = before + 완전한 apply 레코드 → rollback이 이것만으로 역재생).
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

  -- 1) 기존 마감: valid_to = 오늘-1 (id 타겟). 이미 마감된 행(valid_to < 오늘)은 건드리지 않음(멱등).
  for rec in
    select value from jsonb_array_elements(coalesce(p_payload->'closes', '[]'::jsonb)) as t(value)
  loop
    update public.class_schedules s
       set valid_to = p_today - 1
     where s.id = (rec->>'id')::uuid
       and s.tenant_id = v_tenant
       and (s.valid_to is null or s.valid_to >= p_today);
    if found then v_closed := v_closed + 1; end if;
  end loop;

  -- 2) 신규 삽입: valid_from = 오늘. id는 서버 생성(롤백 식별). class_id는 RLS+FK로 본 테넌트 강제.
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
      p_today, null,
      nullif(rec->>'teacherId', '')::uuid, nullif(rec->>'classroomId', '')::uuid,
      nullif(rec->>'slotTeacherLabel', ''), nullif(rec->>'slotRoomLabel', '')
    );
    v_inserted := v_inserted + 1;
  end loop;

  -- 3) classes 담임/기본강의실 — 해석된 값만(null 덮어쓰기 금지). 서버가 이미 modal·prev로 필터해 넘김.
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
    jsonb_build_object('kind', 'english_structure', 'closed', v_closed, 'inserted', v_inserted,
                       'classUpdated', v_classupd, 'summary', p_payload->'summary'),
    p_payload->'planItems', auth.uid()
  );

  return jsonb_build_object('snapshotId', v_snapshot, 'closed', v_closed,
                            'inserted', v_inserted, 'classUpdated', v_classupd);
end;
$$;

-- ── 롤백 ──────────────────────────────────────────────────────────────────────
-- 스냅샷 payload.apply(closes[{id,prevValidTo}]·inserts[{id}]·classUpdates[{classId,prev*}])를 역재생.
-- 순서: 삽입행 삭제 → 마감행 valid_to 복원 → classes prev 복원(적용값과 동일할 때만, 이후 수동변경 보호).
create or replace function public.rollback_english_structure(p_snapshot_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant   uuid := auth_tenant_id();
  v_apply    jsonb;
  v_deleted  int := 0;
  v_restored int := 0;
  v_classrev int := 0;
  rec        jsonb;
begin
  if v_tenant is null then
    raise exception 'rollback_english_structure: 인증된 테넌트가 없습니다';
  end if;

  select payload->'apply' into v_apply
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

  -- 2) 마감행 valid_to 복원(적용 때 오늘-1로 닫은 것을 이전 값으로).
  for rec in select value from jsonb_array_elements(coalesce(v_apply->'closes', '[]'::jsonb)) as t(value)
  loop
    update public.class_schedules
       set valid_to = nullif(rec->>'prevValidTo', '')::date
     where id = (rec->>'id')::uuid and tenant_id = v_tenant;
    if found then v_restored := v_restored + 1; end if;
  end loop;

  -- 3) classes 복원 — 필드 독립(강사·강의실 각각), 적용된 필드만, 현재 값이 적용값과 같을 때만
  --    (한 필드만 바꾼 반의 다른 필드를 오복원하지 않도록 + 이후 수동변경 보호).
  --    apply payload의 teacherId/classroomId: JSON null=미변경(그 필드 롤백 스킵), uuid=적용값.
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

  -- 이력: 해당 스냅샷 로그에 restored_at 마킹.
  update public.timetable_import_logs
     set restored_at = now()
   where snapshot_id = p_snapshot_id and tenant_id = v_tenant and restored_at is null;

  return jsonb_build_object('deleted', v_deleted, 'restored', v_restored, 'classReverted', v_classrev);
end;
$$;
