-- 0345b — 예약 확정의 자원 검사(회차 단위): 정규 시간표 해석 · 강사 · 강의실 정원
--
-- 충돌의 정의(계획 §6):
--   ① 같은 학생이 같은 시각에 서로 다른 수업/보강에 있음(0345c)
--   ② 그 시각 정규 재원 인원 + 보강 참여 인원이 강의실 정원을 넘음
--   ③ 같은 강사가 같은 시각에 서로 다른 강의실에 배정됨
--   같은 강의실에서 정규 수업 중 보강 학생을 함께 받는 것(합류)은 허용하되 정원은 센다.
-- 🔴 화면이 보낸 "빈자리" 정보를 믿지 않는다 — 잠금(0345a gate)을 잡은 같은 트랜잭션에서 여기서 다시 센다.
-- 🔴 강의실 정원(classrooms.capacity)이 없으면 거절한다. 요청의 capacity는 그 이하로 **줄이는** 용도뿐이다
--    (정원 미설정을 요청값으로 메우지 않는다).
-- 휴원일(학원 설정)에는 정규 수업이 없으므로 정규 시간표와의 충돌을 세지 않는다.
-- 멱등: create or replace.

-- 그 날짜에 실제로 도는 정규 교시(실효 강사·강의실 = 교시 값 ?? 반 기본값).
create or replace function makeup_private.regular_slots(p_tenant uuid, p_date date)
returns table (class_id uuid, subject text, teacher_id uuid, classroom_id uuid, start_time time, end_time time)
language sql stable security definer set search_path = public, pg_temp as $$
  select cs.class_id, c.subject, coalesce(cs.teacher_id, c.teacher_id), coalesce(cs.classroom_id, c.classroom_id),
         cs.start_time, cs.end_time
    from public.class_schedules cs
    join public.classes c on c.id = cs.class_id and c.tenant_id = cs.tenant_id
   where cs.tenant_id = p_tenant
     and cs.day_of_week::text = (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_date)::integer]
     and cs.valid_from <= p_date and (cs.valid_to is null or cs.valid_to >= p_date)
     and c.is_active and (c.closed_at is null or c.closed_at >= p_date)
     and not makeup_private.is_holiday(p_tenant, p_date)
$$;

-- 그 날짜에 그 반에 다니는 학생(수강 기간 · 분리등원 요일 반영).
create or replace function makeup_private.attends_on(p_tenant uuid, p_student uuid, p_class uuid, p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.enrollments e
     where e.tenant_id = p_tenant and e.student_id = p_student and e.class_id = p_class
       and e.start_date <= p_date and (e.end_date is null or e.end_date > p_date)
       and (cardinality(e.attendance_days) = 0
            or (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_date)::integer] = any (e.attendance_days)))
$$;

-- 합류할 반만 주고 강사·강의실을 비웠으면 그 요일·교시의 실효 값을 서버가 먼저 정한다. 모호하면 확인을 요구한다.
create or replace function makeup_private.resolve_host(
  p_tenant uuid, p_class uuid, p_date date, p_start time, p_end time,
  inout io_teacher uuid, inout io_room uuid
) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_teachers uuid[];
  v_rooms uuid[];
begin
  if p_class is null then return; end if;
  select array_agg(distinct r.teacher_id) filter (where r.teacher_id is not null),
         array_agg(distinct r.classroom_id) filter (where r.classroom_id is not null)
    into v_teachers, v_rooms
    from makeup_private.regular_slots(p_tenant, p_date) r
   where r.class_id = p_class and r.start_time < p_end and r.end_time > p_start;
  if v_teachers is null and v_rooms is null then
    perform makeup_private.fail('invalid', '그 시간에는 합류할 반의 수업이 없습니다 — 반과 교시를 다시 확인해 주세요');
  end if;
  if io_teacher is null then
    if coalesce(cardinality(v_teachers), 0) <> 1 then
      perform makeup_private.fail('invalid', '그 시간의 담당 강사를 정할 수 없습니다 — 강사를 직접 골라 주세요');
    end if;
    io_teacher := v_teachers[1];
  end if;
  if io_room is null then
    if coalesce(cardinality(v_rooms), 0) <> 1 then
      perform makeup_private.fail('invalid', '그 시간의 강의실을 정할 수 없습니다 — 강의실을 직접 골라 주세요');
    end if;
    io_room := v_rooms[1];
  elsif v_rooms is not null and not (io_room = any (v_rooms)) then
    perform makeup_private.fail('invalid', '합류할 반의 강의실과 다릅니다 — 강의실을 다시 골라 주세요');
  end if;
end;
$$;

-- 강사·강의실이 이 학원의 유효한 값인지와 회차 정원(강의실 정원 이하)을 정한다.
create or replace function makeup_private.resolve_capacity(
  p_tenant uuid, p_teacher uuid, p_room uuid, p_requested integer, out o_capacity integer, out o_room_capacity integer
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_teacher is null or not exists (
       select 1 from public.users u where u.id = p_teacher and u.tenant_id = p_tenant
          and u.status = 'active' and u.system_role::text <> 'student') then
    perform makeup_private.fail('invalid', '보강을 맡을 강사를 골라 주세요 — 재직 중인 직원만 고를 수 있습니다');
  end if;
  if p_room is null then
    perform makeup_private.fail('invalid', '보강할 강의실을 골라 주세요');
  end if;
  select cr.capacity into o_room_capacity from public.classrooms cr where cr.id = p_room and cr.tenant_id = p_tenant;
  if not found then
    perform makeup_private.fail('invalid', '강의실을 찾을 수 없습니다 — 다시 골라 주세요');
  end if;
  if o_room_capacity is null or o_room_capacity < 1 then
    perform makeup_private.fail('invalid', '강의실 정원이 설정되어 있지 않습니다 — 학원 설정에서 정원을 넣은 뒤 다시 시도해 주세요');
  end if;
  if p_requested is not null and (p_requested < 1 or p_requested > o_room_capacity) then
    perform makeup_private.fail('invalid', '회차 정원은 1명 이상, 강의실 정원 이하여야 합니다');
  end if;
  o_capacity := coalesce(p_requested, o_room_capacity);
end;
$$;

-- 회차 단위 충돌 검사. p_session = 이미 있는 회차(자기 자신은 빼고 센다) · p_adding = 이번에 더하는 학생 수.
create or replace function makeup_private.check_session_resources(
  p_tenant uuid, p_session uuid, p_date date, p_start time, p_end time,
  p_teacher uuid, p_room uuid, p_capacity integer, p_room_capacity integer, p_adding integer
) returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_here integer;
  v_regular integer;
  v_makeup integer;
begin
  -- ③ 강사: 같은 시각 다른 강의실(보강 · 정규).
  if exists (
    select 1 from public.makeup_sessions s
     where s.tenant_id = p_tenant and s.state in ('confirmed', 'finished') and s.session_date = p_date
       and s.teacher_id = p_teacher and s.id is distinct from p_session
       and s.start_time < p_end and s.end_time > p_start and s.classroom_id is distinct from p_room) then
    perform makeup_private.fail('conflict', '강사가 같은 시간에 다른 강의실의 보강을 맡고 있습니다 — 시간이나 강사를 바꿔 주세요');
  end if;
  if exists (
    select 1 from makeup_private.regular_slots(p_tenant, p_date) r
     where r.teacher_id = p_teacher and r.start_time < p_end and r.end_time > p_start
       and r.classroom_id is distinct from p_room) then
    perform makeup_private.fail('conflict', '강사가 같은 시간에 다른 강의실에서 정규 수업이 있습니다 — 시간이나 강사를 바꿔 주세요');
  end if;

  -- 회차 정원(마지막 자리 경합은 gate 잠금 뒤 여기서 한 요청만 통과한다).
  -- 자리를 차지하는 참여 = 미기록·왔다·일부. 취소와 노쇼는 자리를 비운 것이다(노쇼를 되돌릴 때 여기서 다시 센다).
  select count(*) into v_here from public.makeup_participants p
   where p.tenant_id = p_tenant and p.session_id = p_session and p.status in ('unknown', 'present', 'partial');
  if v_here + p_adding > p_capacity then
    perform makeup_private.fail('conflict', '이 회차의 정원이 찼습니다 — 다른 시간을 골라 주세요',
      jsonb_build_object('capacity', p_capacity, 'taken', v_here));
  end if;

  -- ② 강의실: 그 시각 정규 재원 인원 + 보강 참여 인원(이번에 더하는 인원 포함).
  select count(distinct e.student_id) into v_regular
    from makeup_private.regular_slots(p_tenant, p_date) r
    join public.enrollments e on e.tenant_id = p_tenant and e.class_id = r.class_id and not e.on_hold
   where r.classroom_id = p_room and r.start_time < p_end and r.end_time > p_start
     and makeup_private.attends_on(p_tenant, e.student_id, e.class_id, p_date);
  select count(*) into v_makeup
    from public.makeup_participants p
    join public.makeup_sessions s on s.id = p.session_id
   where s.tenant_id = p_tenant and s.state in ('confirmed', 'finished') and s.session_date = p_date and s.classroom_id = p_room
     and s.start_time < p_end and s.end_time > p_start and p.status in ('unknown', 'present', 'partial');
  if v_regular + v_makeup + p_adding > p_room_capacity then
    perform makeup_private.fail('conflict', '강의실 정원을 넘습니다 — 다른 시간이나 강의실을 골라 주세요',
      jsonb_build_object('room_capacity', p_room_capacity, 'regular', v_regular, 'makeup', v_makeup));
  end if;
end;
$$;

revoke all on all functions in schema makeup_private from public, anon, authenticated;
