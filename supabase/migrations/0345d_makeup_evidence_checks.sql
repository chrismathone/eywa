-- 0345d — 실시 증거 검사: 보고서 연결 · 출결 연결 · 예상 시수(서버 계산)
--
-- 🔴 정규 수업일의 출석은 보강을 실제로 했다는 증거가 아니다. 그날 칸에 시수가 미리 얹혀 있어도(정규 자동값 + 보강값)
--    그것은 **관측**이다. 참여·실제 분·예약 행 이행은 아래 증거가 있을 때만 바뀐다(0346e).
-- 보고서(assert_report) — 연결은 보고서를 고치지 않는다. 아래를 전부 만족해야 한다:
--   · 같은 학원·학생·날짜 · 반 없는 보고서(class_id IS NULL) · makeup = true · subject = unit_key = 참여의 과목
--   · makeup_class_id = 참여의 앵커 반(보고서 반 = 출석부 반 = 발송 반)
--   · created_by = 회차의 실제 강사(데스크 대리 제출이 소유권을 바꾸지 않는다)
--   · classnote_status가 processing · recall_requested · recalling · recalled 가 아닐 것(앱의 발송 처리 중·회수 판정과 같은 값).
--     이미 보낸(success) 보강 보고서는 연결할 수 있다.
-- 출결(attendance_issue) — null이면 맞음, 아니면 사유 코드. 저장된 **지금 값**으로 본다:
--   · 같은 학원·학생·날짜·앵커 반 · 그 칸의 최신 유효 행(정정으로 덮인 행 불가)
--   · 교시 행이면 회차 구간 안에서 시작하는 교시 · 왔다/일부면 시수 상태(출석·지각·조퇴·보강)
--   · 귀속 강사 = 회차 강사: taught_by가 있으면 그 값, 없으면 그날 그 반 담당(담임·교시 강사·위임)
--   · 그날 그 반의 **다른 유효 칸도** 본다(0345c day_stamps — 교시마다 최신 정정 · 시수 상태인 칸): 찍힌 담당이 하나라도
--     회차 강사와 다르거나, 담당이 안 찍힌 칸을 이 강사의 것으로 볼 수 없으면 regular_teacher_differs. 연결한 칸 하나가
--     맞다고 다른 칸을 덮지 않는다. 행이 들어온 순서와 무관하다.
--   · 정규 수업일이면 그 반의 정규 강사(시간표)가 정확히 회차 강사 한 명 — 찍힌 담당이 맞아도 이 검사는 그대로 한다.
-- 예상 시수(expected_units) — 클라이언트 값을 권위로 쓰지 않는다. 기존 자동 시수와 같은 식이다(auto-units.ts
--   `autoUnitsOn`·`unitsFromMinutes`): 정규 = ceil(그날 그 반 수업 분 합 ÷ 60) ÷ 2(같은 시작 시각은 한 번, 자리 교시 제외),
--   보강 = ceil(회차 분 ÷ 60) ÷ 2(왔다일 때 · 안 왔으면 0), 합계 = 둘의 합(상한 20).
--   · 자동 시수를 쓰지 않는 지점(preset = generic)·수학이 아닌 과목은 계산하지 않는다(전부 null → 시수 대조를 건너뛴다).
--   · 일부 참여는 보강분을 정할 수 없다(o_makeup·o_total null) → 사람이 본다.
--   · 이 함수는 시수를 **쓰지 않는다**. 수기 시수는 그대로 두고 차이만 대사로 올린다.
--   · 자리 교시 이름 목록은 src/features/timetable/lib/teacher-label.ts `SPECIAL_BY_ALIAS`의 **미러**다 — 그 표를 바꾸면
--     같은 커밋에서 여기도 바꿀 것(tests/makeup-db/run.mjs의 미러 대조가 어긋남을 잡는다).
-- 멱등: create or replace.

create or replace function makeup_private.is_regular_day(p_tenant uuid, p_student uuid, p_class uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_class is not null and makeup_private.attends_on(p_tenant, p_student, p_class, p_date)
     and exists (select 1 from makeup_private.regular_slots(p_tenant, p_date) r where r.class_id = p_class)
$$;

-- 보고서가 이 참여의 증거로 맞는가 — null이면 맞음, 아니면 사유 코드. 연결할 때(assert_report)와 연결 뒤 관측(0349f)이 함께 쓴다.
create or replace function makeup_private.report_issue(
  p_tenant uuid, p_report uuid, p_part public.makeup_participants, p_teacher uuid
) returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  select to_jsonb(lr) into v from public.lesson_reports lr
   where lr.id = p_report and lr.tenant_id = p_tenant and lr.student_id = p_part.student_id and lr.report_date = p_part.session_date;
  if v is null then return 'report_missing'; end if;
  if v ->> 'class_id' is not null or coalesce((v ->> 'makeup')::boolean, false) is not true
     or v ->> 'subject' is distinct from p_part.subject_key or coalesce(v ->> 'unit_key', v ->> 'subject') is distinct from p_part.subject_key then
    return 'report_not_makeup';
  end if;
  if p_part.anchor_class_id is null or v ->> 'makeup_class_id' is distinct from p_part.anchor_class_id::text then return 'report_other_anchor'; end if;
  if p_teacher is null or v ->> 'created_by' is distinct from p_teacher::text then return 'report_other_teacher'; end if;
  if v ->> 'classnote_status' = 'processing' then return 'report_sending'; end if;
  if v ->> 'classnote_status' in ('recall_requested', 'recalling', 'recalled') then return 'report_recalled'; end if;
  return null;
end;
$$;

create or replace function makeup_private.assert_report(
  p_tenant uuid, p_report uuid, p_part public.makeup_participants, p_teacher uuid
) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_issue text;
begin
  if p_report is null then return; end if;
  v_issue := makeup_private.report_issue(p_tenant, p_report, p_part, p_teacher);
  if v_issue is not null then
    perform makeup_private.fail('invalid', case v_issue
      when 'report_missing' then '이 보강과 학생·날짜가 같은 보고서만 연결할 수 있습니다'
      when 'report_not_makeup' then '반 없는 같은 과목의 보강 보고서만 연결할 수 있습니다 — 정규 수업 보고서는 보강 근거가 아닙니다'
      when 'report_other_anchor' then '보고서의 보강 반이 이 보강의 출결 반과 다릅니다 — 보고서와 출결 반을 먼저 맞춰 주세요'
      when 'report_other_teacher' then '이 보강을 실제로 가르친 강사가 쓴 보고서만 연결할 수 있습니다'
      else '발송 처리 중이거나 회수된 보고서는 연결할 수 없습니다 — 처리가 끝난 뒤 다시 시도해 주세요' end,
      jsonb_build_object('reason', v_issue));
  end if;
  if exists (select 1 from public.makeup_fulfillments f
              where f.tenant_id = p_tenant and f.report_id = p_report and f.state <> 'reversed'
                and f.participant_id <> p_part.id) then
    perform makeup_private.fail('conflict', '이미 다른 보강에 연결된 보고서입니다');
  end if;
end;
$$;

create or replace function makeup_private.attendance_issue(
  p_tenant uuid, p_att uuid, p_part public.makeup_participants, p_teacher uuid, p_start time, p_end time, p_status text
) returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v jsonb;
  v_teachers uuid[];
  v_day record;
begin
  if p_part.anchor_class_id is null then return 'anchor_missing'; end if;
  select to_jsonb(ar) into v from public.attendance_records ar where ar.id = p_att and ar.tenant_id = p_tenant;
  if v is null then return 'attendance_missing'; end if;
  if v ->> 'student_id' <> p_part.student_id::text or (v ->> 'session_date')::date <> p_part.session_date
     or v ->> 'class_id' <> p_part.anchor_class_id::text then
    return 'attendance_other_cell';
  end if;
  if exists (
    select 1 from public.attendance_records n
     where n.tenant_id = p_tenant and n.student_id = p_part.student_id and n.class_id = p_part.anchor_class_id
       and n.session_date = p_part.session_date and n.slot_start is not distinct from (v ->> 'slot_start')::time
       and (n.recorded_at, n.id) > ((v ->> 'recorded_at')::timestamptz, p_att)) then
    return 'attendance_superseded';
  end if;
  if v ->> 'slot_start' is not null and not ((v ->> 'slot_start')::time >= p_start and (v ->> 'slot_start')::time < p_end) then
    return 'attendance_other_slot';
  end if;
  if p_status <> 'no_show' and v ->> 'status' not in ('present', 'late', 'early_leave', 'makeup') then
    return 'attendance_not_countable';
  end if;
  -- 안 왔다는 기록에는 귀속 강사가 뜻이 없다(결석 칸은 누구의 시수도 아니다) — 칸·최신 행 확인까지만.
  if p_status = 'no_show' then return null; end if;
  if p_teacher is null then return 'attendance_other_teacher'; end if;
  if v ->> 'taught_by' is not null then
    if v ->> 'taught_by' <> p_teacher::text then return 'attendance_other_teacher'; end if;
  elsif not (p_part.anchor_class_id in (select makeup_private.my_class_ids(p_tenant, p_teacher, p_part.session_date))) then
    return 'attendance_other_teacher';
  end if;
  -- 그날의 다른 유효 칸: 찍힌 담당이 갈리거나 다르면, 또는 담당이 안 찍힌 칸을 이 강사의 반으로 볼 수 없으면 붙잡는다.
  select * into v_day from makeup_private.day_stamps(p_tenant, p_part.student_id, p_part.anchor_class_id, p_part.session_date);
  if (v_day.o_teachers is not null and (cardinality(v_day.o_teachers) <> 1 or v_day.o_teachers[1] <> p_teacher))
     or (v_day.o_blank and not (p_part.anchor_class_id in (select makeup_private.my_class_ids(p_tenant, p_teacher, p_part.session_date)))) then
    return 'regular_teacher_differs';
  end if;
  if makeup_private.is_regular_day(p_tenant, p_part.student_id, p_part.anchor_class_id, p_part.session_date) then
    select array_agg(distinct r.teacher_id) into v_teachers
      from makeup_private.regular_slots(p_tenant, p_part.session_date) r where r.class_id = p_part.anchor_class_id;
    if cardinality(v_teachers) <> 1 or v_teachers[1] is distinct from p_teacher then return 'regular_teacher_differs'; end if;
  end if;
  return null;
end;
$$;

-- 사유 코드 → 화면 문장.
create or replace function makeup_private.attendance_issue_text(p_code text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case p_code
    when 'anchor_missing' then '출결 반이 정해지지 않은 보강입니다 — 출결 반을 먼저 정해 주세요'
    when 'attendance_missing' then '출결 기록을 찾을 수 없습니다'
    when 'attendance_other_cell' then '이 보강의 학생·날짜·출결 반과 맞는 출결 기록만 연결할 수 있습니다'
    when 'attendance_superseded' then '정정으로 바뀐 옛 출결 기록입니다 — 지금 유효한 기록을 골라 주세요'
    when 'attendance_other_slot' then '보강 시간 밖의 교시 출결은 연결할 수 없습니다'
    when 'attendance_not_countable' then '결석으로 기록된 날입니다 — 출결을 먼저 확인해 주세요'
    when 'attendance_other_teacher' then '출결의 담당 강사가 이 보강의 강사와 다릅니다 — 출석부에서 담당 강사를 확인해 주세요'
    when 'regular_teacher_differs' then '같은 날 정규 수업의 강사가 보강 강사와 달라 한 칸에 함께 기록할 수 없습니다'
    when 'units_mismatch' then '출결의 시수가 예상과 다릅니다 — 시수를 확인해 주세요'
    when 'participation_missing' then '참여 결과를 먼저 기록해 주세요'
    when 'no_show_with_attendance' then '안 온 것으로 기록했는데 그 칸에 출석이 있습니다 — 출결과 시수를 확인해 주세요'
    else '출결 기록을 확인하지 못했습니다' end
$$;

create or replace function makeup_private.units_from_minutes(p_minutes numeric) returns numeric
language sql immutable set search_path = pg_catalog as $$
  select case when p_minutes is null or p_minutes <= 0 then 0.0 else round(least(20, ceil(p_minutes / 60.0) / 2.0), 1) end
$$;

create or replace function makeup_private.expected_units(
  p_tenant uuid, p_part public.makeup_participants, p_start time, p_end time, p_status text,
  out o_makeup numeric, out o_regular numeric, out o_total numeric
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_part.subject_key <> 'math' or p_part.anchor_class_id is null
     or (select ts.data ->> 'preset' from public.tenant_settings ts where ts.tenant_id = p_tenant) is not distinct from 'generic' then
    return;
  end if;
  o_regular := 0;
  if makeup_private.is_regular_day(p_tenant, p_part.student_id, p_part.anchor_class_id, p_part.session_date) then
    select makeup_private.units_from_minutes(sum(q.m)) into o_regular from (
      select distinct on (cs.start_time) extract(epoch from (cs.end_time - cs.start_time)) / 60 as m
        from public.class_schedules cs
       where cs.tenant_id = p_tenant and cs.class_id = p_part.anchor_class_id
         and cs.day_of_week::text = (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_part.session_date)::integer]
         and cs.valid_from <= p_part.session_date and (cs.valid_to is null or cs.valid_to >= p_part.session_date)
         and lower(btrim(coalesce(to_jsonb(cs) ->> 'slot_teacher_label', ''))) not in ('lab', 'lab실', '이주희', '랩실', 'jj', '집중자율수업실', '자율실')
       order by cs.start_time) q;
  end if;
  o_makeup := case p_status
    when 'present' then makeup_private.units_from_minutes(extract(epoch from (p_end - p_start)) / 60)
    when 'no_show' then 0 end;
  o_total := o_regular + o_makeup;
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
