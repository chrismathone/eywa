-- 일정 변경: 다 비운 옛 회차는 새 자리를 검사하기 전에 닫는다(0350d) — 강의실만 바꾸기 · 남은 학생이 있을 때의 진짜 충돌 · 실패 시 전부 되돌림
begin;
select mt.seed_on();
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 120) as a1,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-6), 120) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-6), 120) as c1,
  mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1,
  mt.approved_case(mt.id(65), mt.id(52), mt.d(-5), 120) as e1;
create function pg_temp.q(p_case uuid) returns text language sql as $$
  select format('O=%s C=%s R=%s', outstanding_minutes, committed_minutes, outstanding_minutes - committed_minutes)
    from public.makeup_cases where id = p_case $$;
create function pg_temp.sess(p_part uuid) returns uuid language sql as $$
  select session_id from public.makeup_participants where id = p_part $$;
-- 같은 날짜·같은 교시·같은 강사로 강의실만 바꾸는 변경 요청.
create function pg_temp.room_move(p_session uuid, p_part uuid, p_date date, p_room uuid) returns jsonb language sql as $$
  select jsonb_build_object('session_id', p_session, 'session_date', p_date, 'period_ids', '["1","2"]'::jsonb,
    'teacher_id', mt.id(25), 'classroom_id', p_room, 'reason', '합성 강의실 변경')
    || case when p_part is null then '{}'::jsonb else jsonb_build_object('participant_id', p_part) end $$;

-- ① 학생 한 명뿐인 회차: 같은 강사·같은 시간에 강의실만 1 → 2. 전에는 자기 옛 회차가 "같은 강사·다른 강의실"로 잡혀 항상 거절됐다.
create temp table p1 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), array['1','2'], 60) as id;
create temp table s1 as select pg_temp.sess((select id from p1)) as id;
create temp table m1 as select mt.cmd(mt.id(22), 'reschedule',
  pg_temp.room_move((select id from s1), (select id from p1), mt.d(3), mt.id(42)), mt.rev('makeup_sessions', (select id from s1))) as r;
select mt.ok((select (r ->> 'session_id')::uuid <> (select id from s1) from m1), '강의실만 바꾸는 변경이 통과한다(새 회차)');
select mt.eq((select state || ':' || coalesce(cancel_cause, '') from public.makeup_sessions where id = (select id from s1)), 'rescheduled:reschedule', '옛 회차는 변경됨으로 닫힌다');
select mt.eq((select replaced_by_session_id from public.makeup_sessions where id = (select id from s1)), (select (r ->> 'session_id')::uuid from m1), '옛 회차가 새 회차로 이어진다');
select mt.eq((select state || ':' || classroom_id::text from public.makeup_sessions where id = (select (r ->> 'session_id')::uuid from m1)), 'confirmed:' || mt.id(42)::text, '새 회차는 2강의실 확정');
select mt.eq((select status from public.makeup_participants where id = (select id from p1)), 'cancelled', '옛 참여는 취소로 남는다(지우지 않는다)');
select mt.eq((select released_minutes || ':' || release_reason from public.makeup_allocations where participant_id = (select id from p1)), '60:rescheduled', '옛 배정은 해제량으로 남는다');
select mt.eq((select count(*)::int from public.makeup_participants where student_id = mt.id(61) and status = 'unknown'), 1, '새 참여 1건');
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=60 R=60', '변경은 점유를 옮길 뿐 늘리지 않는다');
select mt.eq((select count(*)::int from public.makeup_events where event_type = 'session_rescheduled' and entity_id = (select id from s1)), 1, '회차 변경 이벤트 1건');
select mt.eq((select count(*)::int from public.attendance_records), 0, '변경은 출결을 쓰지 않는다');

-- ② 두 학생이 있는 회차에서 한 명만 같은 시간 다른 강의실로: 같은 강사가 두 강의실을 맡게 된다 → 종전대로 거절.
create temp table p2 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(4), array['1','2'], 30) as id;
create temp table s2 as select pg_temp.sess((select id from p2)) as id;
create temp table p3 as select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(62), 'session_id', (select id from s2),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 30)))) ->> 'id')::uuid as id;
select mt.eq((select count(*)::int from public.makeup_participants where session_id = (select id from s2) and status = 'unknown'), 2, '한 회차에 두 학생');
create temp table before2 as select (select count(*)::int from public.makeup_sessions) as sessions,
  (select count(*)::int from public.makeup_events) as events;
select mt.cmd_throws(mt.id(22), 'reschedule', pg_temp.room_move((select id from s2), (select id from p3), mt.d(4), mt.id(42)),
  mt.rev('makeup_sessions', (select id from s2)), 'conflict', '남은 학생이 있으면 같은 강사의 같은 시간 다른 강의실은 거절');
select mt.eq((select state from public.makeup_sessions where id = (select id from s2)), 'confirmed', '거절 뒤 옛 회차는 확정 그대로');
select mt.eq((select status from public.makeup_participants where id = (select id from p3)), 'unknown', '거절 뒤 참여는 그대로');
select mt.eq((select released_minutes from public.makeup_allocations where participant_id = (select id from p3)), 0, '거절 뒤 배정은 풀리지 않았다');
select mt.eq((select count(*)::int from public.makeup_sessions), (select sessions from before2), '거절 뒤 새 회차가 남지 않는다');
select mt.eq((select count(*)::int from public.makeup_events), (select events from before2), '거절 뒤 이벤트가 남지 않는다');
select mt.eq(pg_temp.q((select b1 from k)), 'O=120 C=30 R=90', '거절 뒤 수량 그대로');

-- ③ 같은 회차를 통째로(두 학생 모두) 옮기면 옛 회차가 비므로 통과한다 — 새 회차 하나에 두 학생.
create temp table m3 as select mt.cmd(mt.id(22), 'reschedule', pg_temp.room_move((select id from s2), null, mt.d(4), mt.id(42)),
  mt.rev('makeup_sessions', (select id from s2))) as r;
select mt.eq((select count(*)::int from public.makeup_participants where session_id = (select (r ->> 'session_id')::uuid from m3) and status = 'unknown'), 2, '새 회차 하나에 두 학생');
select mt.eq((select state from public.makeup_sessions where id = (select id from s2)), 'rescheduled', '통째로 옮긴 옛 회차는 변경됨');
select mt.eq((select replaced_by_session_id from public.makeup_sessions where id = (select id from s2)), (select (r ->> 'session_id')::uuid from m3), '통째로 옮긴 옛 회차도 새 회차로 이어진다');
select mt.eq(pg_temp.q((select a1 from k)) || ' / ' || pg_temp.q((select b1 from k)), 'O=120 C=90 R=30 / O=120 C=30 R=90', '통째 변경 뒤 두 건의 점유 그대로');

-- ④ 새 자리를 못 잡으면 전부 되돌아간다: 2강의실(정원 2)이 그 시간에 이미 찼다 → 옛 회차를 닫은 것까지 되돌림.
select mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(64), 'session_date', mt.d(5), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(26), 'classroom_id', mt.id(42), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select d1 from k), 'minutes', 30))));
select mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(65), 'session_id',
  (select p.session_id from public.makeup_participants p where p.student_id = mt.id(64) and p.session_date = mt.d(5)),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select e1 from k), 'minutes', 30))));
create temp table p4 as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(5), array['1','2'], 60) as id;
create temp table s4 as select pg_temp.sess((select id from p4)) as id;
create temp table before4 as select (select count(*)::int from public.makeup_sessions) as sessions,
  (select revision from public.makeup_sessions where id = (select id from s4)) as rev;
select mt.cmd_throws(mt.id(22), 'reschedule', pg_temp.room_move((select id from s4), (select id from p4), mt.d(5), mt.id(42)),
  (select rev from before4), 'conflict', '새 강의실 정원이 차 있으면 변경 거절');
select mt.eq((select state || ':' || revision from public.makeup_sessions where id = (select id from s4)), 'confirmed:' || (select rev from before4), '거절 뒤 옛 회차는 확정 · 개정 번호도 그대로(닫은 것까지 되돌림)');
select mt.ok((select replaced_by_session_id is null and cancel_cause is null from public.makeup_sessions where id = (select id from s4)), '거절 뒤 옛 회차에 변경 흔적이 없다');
select mt.eq((select status || ':' || (select released_minutes from public.makeup_allocations where participant_id = (select id from p4))
  from public.makeup_participants where id = (select id from p4)), 'unknown:0', '거절 뒤 참여·배정 그대로');
select mt.eq((select count(*)::int from public.makeup_sessions), (select sessions from before4), '거절 뒤 새 회차 없음');
select mt.eq(pg_temp.q((select c1 from k)), 'O=120 C=60 R=60', '거절 뒤 수량 그대로');
-- 같은 요청을 빈 강의실로 다시 보내면 통과한다(옛 회차가 정말 그대로였다는 뜻).
select mt.ok((select (mt.cmd(mt.id(22), 'reschedule', pg_temp.room_move((select id from s4), (select id from p4), mt.d(6), mt.id(42)),
  (select rev from before4)) ->> 'session_id') is not null), '거절된 뒤 같은 개정 번호로 다른 날짜 변경은 통과');

-- ⑤ 강사 범위: 본인 회차의 강의실 변경도 같은 규칙으로 통과한다(권한 검사는 그대로 — 남의 회차는 거절).
create temp table p5 as select (mt.cmd(mt.id(25), 'reserve', jsonb_build_object('student_id', mt.id(62), 'session_date', mt.d(7),
  'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 30)))) ->> 'id')::uuid as id;
select mt.cmd_throws(mt.id(26), 'reschedule', pg_temp.room_move(pg_temp.sess((select id from p5)), (select id from p5), mt.d(7), mt.id(42)),
  mt.rev('makeup_sessions', pg_temp.sess((select id from p5))), 'forbidden', '남의 회차 변경은 종전대로 거절');
select mt.ok((select (mt.cmd(mt.id(25), 'reschedule', pg_temp.room_move(pg_temp.sess((select id from p5)), (select id from p5), mt.d(7), mt.id(42)),
  mt.rev('makeup_sessions', pg_temp.sess((select id from p5)))) ->> 'session_id') is not null), '강사가 본인 회차의 강의실을 바꾼다');
select count(*) as passed from mt.passed;
rollback;
