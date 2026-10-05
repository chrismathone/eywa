-- 노쇼 되돌리기는 자리·시간·분량을 다시 검사한다 (보완 5 — MU-015·016·020·068 · MU-X07)
-- 노쇼는 그 학생의 자리와 배정을 푼다. 잘못 눌렀다고 되돌릴 때 그 사이 바뀐 것을 무시하고 예전 자리를 되살리지 않는다.
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 110) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-13), 240) as c1;
-- 회차 S: 오늘 1~2교시 · 강사가 · 2강의실(정원 2). 학생A가 열고 학생B가 합류 → 만석.
create temp table sa as select mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(0), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(25), 'classroom_id', mt.id(42), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110)))) as r;
create temp table ids as select (r ->> 'session_id')::uuid as s, (r ->> 'participant_id')::uuid as pa from sa;
create function pg_temp.join(p_student uuid, p_case uuid) returns uuid language sql as $$
  select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('session_id', (select s from ids), 'student_id', p_student,
    'allocations', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', 110)))) ->> 'participant_id')::uuid $$;
create function pg_temp.mark(p_part uuid, p_status text) returns jsonb language sql as $$
  select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', p_part, 'status', p_status)
    || case when p_status = 'no_show' then '{}'::jsonb else '{"actual_minutes": 110, "learning_summary": "합성 지도 내용"}'::jsonb end) $$;
create function pg_temp.taken() returns integer language sql as $$
  select count(*)::int from public.makeup_participants where session_id = (select s from ids) and status in ('unknown', 'present', 'partial') $$;
create temp table pb as select pg_temp.join(mt.id(62), (select b1 from k)) as id;
select mt.eq(pg_temp.taken(), 2, '회차 만석(2/2)');
select mt.throws($$select pg_temp.join(mt.id(63), (select c1 from k))$$, 'conflict', 'MU-015 만석 회차 합류 거절');

-- 학생A 노쇼 → 자리와 배정이 풀린다(의무는 그대로). 그 자리에 학생C가 합류한다.
select pg_temp.mark((select pa from ids), 'no_show');
select mt.eq((select committed_minutes || '/' || outstanding_minutes from public.makeup_cases where id = (select a1 from k)) || ':' || pg_temp.taken(), '0/240:1', 'MU-020·X07 노쇼 → 배정 해제 · 의무 유지 · 자리 1 비움');
create temp table pc as select pg_temp.join(mt.id(63), (select c1 from k)) as id;
select mt.eq(pg_temp.taken(), 2, '비워진 자리에 학생C 합류(2/2)');
-- 되돌리기: 그 사이 자리가 찼다 → 거절. 예전 배정·자리를 되살리지 않는다.
select mt.throws($$select pg_temp.mark((select pa from ids), 'present')$$, 'conflict', 'MU-015 노쇼 되돌리기 — 그 사이 찬 자리는 다시 잡지 못한다');
select mt.eq((select status || ':' || coalesce(actual_minutes, 0) from public.makeup_participants where id = (select pa from ids)), 'no_show:0', '거절된 되돌리기는 노쇼 그대로');
select mt.eq((select released_minutes || ':' || release_reason from public.makeup_allocations where participant_id = (select pa from ids)), '110:no_show', '풀린 배정도 그대로(자동 복원 없음)');
select mt.eq(pg_temp.taken() || ':' || (select status from public.makeup_participants where id = (select id from pc)), '2:unknown', '정원 초과 없음 · 학생C의 자리는 그대로');
select mt.eq((select count(*)::int from public.makeup_fulfillments where participant_id = (select pa from ids) and state <> 'reversed'), 0, '거절된 되돌리기는 실시 기록도 만들지 않는다');
-- 자리가 다시 비면(학생C 취소) 되돌릴 수 있다 — 그때의 정원·시간으로 다시 검사해 통과한다.
select mt.cmd(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from pc), 'reason', '합성 취소'), mt.rev('makeup_participants', (select id from pc)));
select mt.eq(pg_temp.mark((select pa from ids), 'present') ->> 'status', 'present', '자리가 있으면 되돌리기 통과');
select mt.eq((select released_minutes from public.makeup_allocations where participant_id = (select pa from ids)) || ':' ||
  (select committed_minutes from public.makeup_cases where id = (select a1 from k)) || ':' || pg_temp.taken(), '0:110:2', '되돌린 뒤 배정·점유가 다시 선다(2/2)');

-- 분량도 다시 검사한다: 학생B 노쇼 뒤 남은 분량 전부(110)를 다른 날로 새로 잡았으면, 옛 자리를 되살릴 분량이 없다.
select pg_temp.mark((select id from pb), 'no_show');
create temp table pb2 as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(3), array['1','2'], 110) as id;
select mt.eq((select committed_minutes || '/' || outstanding_minutes from public.makeup_cases where id = (select b1 from k)), '110/110', '노쇼 뒤 명시적 새 예약이 남은 분량을 전부 잡았다');
select mt.throws($$select pg_temp.mark((select id from pb), 'present')$$, 'conflict', 'MU-068 되돌리면 분량이 넘친다 → 거절(자동 분량 복원 없음)');
select mt.eq((select status from public.makeup_participants where id = (select id from pb)) || ':' ||
  (select committed_minutes from public.makeup_cases where id = (select b1 from k)), 'no_show:110', '학생B는 노쇼 그대로 · 새 예약만 살아 있다');
select mt.eq((select status from public.makeup_participants where id = (select id from pb2)), 'unknown', '새 예약은 건드리지 않는다');

-- 시간도 다시 검사한다: 노쇼 뒤 그 시각에 학생의 정규 수업이 생겼으면 되돌릴 수 없다.
create temp table pc2 as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(0), array['5','6'], 110) as id;
select pg_temp.mark((select id from pc2), 'no_show');
insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
  select mt.id(11), mt.id(51), mt.dow(mt.d(0)), s.start_time, s.end_time, mt.d(-10)
    from public.makeup_sessions s where s.id = (select session_id from public.makeup_participants where id = (select id from pc2));
select mt.throws($$select pg_temp.mark((select id from pc2), 'present')$$, 'conflict', 'MU-016 노쇼 뒤 그 시각에 정규 수업이 생겼으면 되돌리기 거절');
select mt.eq((select status from public.makeup_participants where id = (select id from pc2)), 'no_show', '겹치는 일정이 있으면 노쇼 그대로');
-- 어느 경로에서도 출결·시수·청구를 만들거나 고치지 않았다.
select mt.eq((select count(*)::int from public.attendance_records) + (select count(*)::int from public.invoices), 0, '되돌리기는 출결·시수·청구를 쓰지 않는다');
select count(*) as passed from mt.passed;
rollback;
