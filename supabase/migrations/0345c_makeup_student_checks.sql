-- 0345c — 예약 확정의 학생 단위 검사: 하루 상한 · 시간 겹침 · 기존 기록과의 충돌 · 출결/보고서 앵커 반
--
-- 첫 출시의 서버 계약(계획 §2) — 예약 확정 때 전부 여기서 거절한다(세션·보고서를 쓰기 **전에**):
--   · 같은 학생·과목·날짜의 둘째 보강은 앵커·시각·강사가 달라도 거절(다른 날짜로 잡는다).
--   · 그 학생의 정규 수업·다른 보강과 시간이 겹치면 거절(앞뒤로 붙는 것은 허용).
--   · 출석부에 잡아 둔 연결 안 된 기존 예약이 그날 있으면 거절 — 사람이 먼저 연결을 정한다.
--   · 반 없는 같은 과목 보고서·기존 보강 세션·'보강' 출결이 그날 이미 있으면 거절 — 덮어쓰지 않는다.
--   · 같은 날 앵커 반의 정규 수업이 있으면 그 정규 강사와 보강 강사가 정확히 같을 때만 허용
--     (일별 칸의 귀속 강사는 한 명이다 — 다르거나 정할 수 없으면 다른 날짜). 두 가지를 **모두** 본다:
--       ① 그날 그 반 출결에 이미 찍힌 담당(taught_by) — 교시마다 최신 정정 한 줄, 시수 상태인 칸 전부. 하나라도 다르면 거절.
--       ② 시간표 담당 — 찍힌 담당이 시간표를 대신하지 않는다(합쳐진 칸의 담당은 보강 강사가 찍은 것일 수 있다).
--     검증(0345d attendance_issue)이 같은 두 가지로 붙잡으므로, 예약은 검증이 붙잡을 일정을 미리 거절한다.
--     대체 수업이면 시간표 담당을 먼저 고친 뒤 예약한다.
-- 🔴 이 검사는 **보강 예약만** 막는다. 정규 출결 저장은 어떤 보강 제약으로도 거절하지 않는다(0349b).
-- 그날의 유효 칸 helper(day_cells · day_stamps · day_primary)는 예약(여기)과 검증(0345d·0345e)이 함께 쓴다 — 읽기만 한다.
-- 멱등: create or replace.

-- 그 칸(학생·반·날짜)의 지금 유효한 출결: 교시(없으면 그날 전체)마다 최신 정정 한 줄. 덮인 옛 정정은 세지 않는다.
create or replace function makeup_private.day_cells(p_tenant uuid, p_student uuid, p_class uuid, p_date date)
returns setof public.attendance_records language sql stable security definer set search_path = public, pg_temp as $$
  select distinct on (ar.slot_start) ar.*
    from public.attendance_records ar
   where ar.tenant_id = p_tenant and ar.student_id = p_student and ar.class_id = p_class and ar.session_date = p_date
   order by ar.slot_start, ar.recorded_at desc, ar.id desc
$$;

-- 그날 시수 상태인 칸들에 찍힌 담당(o_teachers — 하나도 없으면 null)과 담당이 안 찍힌 시수 칸이 있는지(o_blank).
create or replace function makeup_private.day_stamps(p_tenant uuid, p_student uuid, p_class uuid, p_date date,
  out o_teachers uuid[], out o_blank boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select array_agg(distinct x.t) filter (where x.t is not null), coalesce(bool_or(x.t is null), false)
    from (select (to_jsonb(c) ->> 'taught_by')::uuid as t
            from makeup_private.day_cells(p_tenant, p_student, p_class, p_date) c
           where c.status::text in ('present', 'late', 'early_leave', 'makeup')) x
$$;

-- 그 참여가 대조할 출결 칸 하나. 행이 들어온 순서와 무관하다(출결 저장 훅의 pickFulfillingRow와 같은 순서):
--   시수 상태인 칸 > 그날 전체 칸 > 회차 구간 안에서 시작하는 교시 칸 > 이른 교시.
create or replace function makeup_private.day_primary(p_tenant uuid, p_part uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id
    from public.makeup_participants p
    join public.makeup_sessions s on s.id = p.session_id
    cross join lateral makeup_private.day_cells(p_tenant, p.student_id, p.anchor_class_id, p.session_date) c
   where p.id = p_part and p.tenant_id = p_tenant
   order by (c.status::text in ('present', 'late', 'early_leave', 'makeup')) desc, (c.slot_start is null) desc,
            coalesce(c.slot_start >= s.start_time and c.slot_start < s.end_time, false) desc, c.slot_start
   limit 1
$$;

create or replace function makeup_private.check_student(
  p_tenant uuid, p_student uuid, p_subject text, p_date date, p_start time, p_end time,
  p_teacher uuid, p_anchor uuid
) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_legacy uuid;
  v_teachers uuid[];
begin
  if exists (
    select 1 from public.makeup_participants p
     where p.tenant_id = p_tenant and p.student_id = p_student and p.subject_key = p_subject
       and p.session_date = p_date and p.status <> 'cancelled') then
    perform makeup_private.fail('conflict', '같은 날 같은 과목의 보강이 이미 있습니다 — 다른 날짜로 잡아 주세요');
  end if;
  if exists (
    select 1 from public.makeup_participants p
      join public.makeup_sessions s on s.id = p.session_id
     where p.tenant_id = p_tenant and p.student_id = p_student and p.session_date = p_date
       and p.status <> 'cancelled' and s.state = 'confirmed'
       and s.start_time < p_end and s.end_time > p_start) then
    perform makeup_private.fail('conflict', '학생이 같은 시간에 다른 보강이 잡혀 있습니다 — 시간을 바꿔 주세요');
  end if;
  if exists (
    select 1 from makeup_private.regular_slots(p_tenant, p_date) r
     where r.start_time < p_end and r.end_time > p_start
       and makeup_private.attends_on(p_tenant, p_student, r.class_id, p_date)) then
    perform makeup_private.fail('conflict', '학생의 정규 수업 시간과 겹칩니다 — 수업 앞뒤 시간으로 잡아 주세요');
  end if;

  -- 연결 안 된 기존 예약(0264a) — 같은 과목이거나 시간이 겹치면 새 일정을 얹지 않는다.
  select r.id into v_legacy
    from public.makeup_reservations r
    join public.classes c on c.id = r.class_id
   where r.tenant_id = p_tenant and r.student_id = p_student and r.makeup_date = p_date
     and (c.subject = p_subject or (r.slot_start < p_end and r.slot_end > p_start))
     and not exists (select 1 from public.makeup_legacy_maps m
                      where m.legacy_kind = 'reservation' and m.legacy_id = r.id and m.state = 'active')
   limit 1;
  if v_legacy is not null then
    perform makeup_private.fail('conflict', '출석부에 잡아 둔 보강 예약이 그날 이미 있습니다 — 기존 예약을 먼저 연결해 주세요',
      jsonb_build_object('legacy_reservation_id', v_legacy));
  end if;

  -- 반 없는 같은 과목 보고서 · 기존 보강 세션 · '보강' 출결 — 있는 기록을 덮어쓰지 않는다.
  if exists (
       select 1 from public.lesson_reports lr
        where lr.tenant_id = p_tenant and lr.student_id = p_student and lr.report_date = p_date
          and lr.class_id is null and lr.subject = p_subject)
     or exists (
       select 1 from public.onescreen_daily_sessions os
        where os.tenant_id = p_tenant and os.student_id = p_student and os.session_date = p_date
          and os.subject_progress ? ('makeup::' || p_subject))
     or exists (
       select 1 from public.attendance_records ar
         join public.classes c on c.id = ar.class_id
        where ar.tenant_id = p_tenant and ar.student_id = p_student and ar.session_date = p_date
          and ar.status = 'makeup' and c.subject = p_subject) then
    perform makeup_private.fail('conflict', '그날 같은 과목의 보강 기록이 이미 있습니다 — 기존 기록을 먼저 연결하거나 다른 날짜로 잡아 주세요');
  end if;

  -- 같은 날 앵커 반의 정규 수업 — 귀속 강사가 보강 강사와 정확히 같아야 한 칸에 함께 적을 수 있다.
  -- ① 그날 이미 찍힌 담당이 있으면 전부 보강 강사여야 한다(대체 강사가 가르친 날을 시간표 담당 이름으로 잡지 못한다).
  if p_anchor is not null and p_teacher is not null then
    select s.o_teachers into v_teachers from makeup_private.day_stamps(p_tenant, p_student, p_anchor, p_date) s;
    if v_teachers is not null and (cardinality(v_teachers) <> 1 or v_teachers[1] <> p_teacher) then
      perform makeup_private.fail('conflict', '그날 출결에 찍힌 담당 강사가 보강 강사와 달라 함께 기록할 수 없습니다 — 출결의 담당을 확인하거나 다른 날짜로 잡아 주세요',
        jsonb_build_object('reason', 'attendance_teacher_differs'));
    end if;
  end if;
  -- ② 시간표 담당(종전 규칙 그대로).
  if p_anchor is not null and makeup_private.attends_on(p_tenant, p_student, p_anchor, p_date) then
    select array_agg(distinct r.teacher_id) into v_teachers
      from makeup_private.regular_slots(p_tenant, p_date) r where r.class_id = p_anchor;
    if v_teachers is not null
       and (cardinality(v_teachers) <> 1 or v_teachers[1] is null or v_teachers[1] <> p_teacher) then
      perform makeup_private.fail('conflict', '같은 날 정규 수업의 담당 강사와 보강 강사가 달라 함께 기록할 수 없습니다 — 다른 날짜로 잡아 주세요');
    end if;
  end if;
end;
$$;

-- 출결·보고서를 세울 반. 직접 고른 반은 엄격히 검증하고, 안 골랐으면 원반이 유효할 때만 쓴다(아니면 null → 대사 큐).
create or replace function makeup_private.resolve_anchor(
  p_tenant uuid, p_student uuid, p_subject text, p_date date, p_requested uuid, p_original uuid
) returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_class uuid := coalesce(p_requested, p_original);
  v_ok boolean;
begin
  if v_class is null then return null; end if;
  select c.subject = p_subject and c.is_active and (c.closed_at is null or c.closed_at >= p_date)
    into v_ok from public.classes c where c.id = v_class and c.tenant_id = p_tenant;
  v_ok := coalesce(v_ok, false) and exists (
    select 1 from public.enrollments e
     where e.tenant_id = p_tenant and e.student_id = p_student and e.class_id = v_class
       and e.start_date <= p_date and (e.end_date is null or e.end_date > p_date));
  if v_ok then return v_class; end if;
  if p_requested is not null then
    perform makeup_private.fail('invalid', '그날 학생이 다니는 같은 과목 반만 출결 반으로 고를 수 있습니다');
  end if;
  return null;
end;
$$;

-- 강사 범위(담당만) 계정의 예약 기한: 원수업 달의 다음 달 말일까지(선보강은 통과). makeupDeadlineOf와 같은 식.
create or replace function makeup_private.within_teacher_deadline(p_original date, p_session date) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_original is null or p_session <= p_original
      or p_session <= (date_trunc('month', p_original) + interval '2 months' - interval '1 day')::date
$$;

-- 회차 한 건의 모양(읽기 RPC·명령 결과가 같이 쓴다).
create or replace function makeup_private.session_json(p_session uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', s.id, 'revision', s.revision, 'class_id', s.class_id, 'teacher_id', s.teacher_id,
    'teacher_name', (select u.display_name from public.users u where u.id = s.teacher_id),
    'classroom_id', s.classroom_id,
    'classroom_name', (select cr.name from public.classrooms cr where cr.id = s.classroom_id),
    'subject_key', s.subject_key, 'session_date', s.session_date,
    'start_time', to_char(s.start_time, 'HH24:MI'), 'end_time', to_char(s.end_time, 'HH24:MI'),
    'period_ids', to_jsonb(s.period_ids), 'period_label', s.period_label, 'capacity', s.capacity,
    'taken', (select count(*) from public.makeup_participants p where p.session_id = s.id and p.status in ('unknown', 'present', 'partial')),
    'state', s.state, 'finish_reason', s.finish_reason, 'cancel_reason', s.cancel_reason, 'cancel_cause', s.cancel_cause,
    'replaced_by_session_id', s.replaced_by_session_id, 'imported', s.imported, 'updated_at', s.updated_at)
  from public.makeup_sessions s where s.id = p_session
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
