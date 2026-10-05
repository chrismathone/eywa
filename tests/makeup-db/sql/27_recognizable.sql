-- 다시 인정할 수 있는 분량(0350a recognizable_minutes) — 검토(0346f)의 식과 같은 값: 반전 뒤 · 그 사이 다른 예약이 분량을 잡은 뒤
begin;
select mt.seed_on();
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 120) as a1,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-6), 120) as b1;
create function pg_temp.q(p_case uuid) returns text language sql as $$
  select format('O=%s C=%s R=%s', outstanding_minutes, committed_minutes, outstanding_minutes - committed_minutes)
    from public.makeup_cases where id = p_case $$;
create function pg_temp.detail(p_actor uuid, p_case uuid) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_case_detail(%L::uuid)', p_case)) $$;
-- 그 참여의 배정 한 줄(상세 읽기에서).
create function pg_temp.alloc(p_case uuid, p_part uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.detail(mt.id(22), p_case) -> 'allocations') x where (x ->> 'participant_id')::uuid = p_part $$;
create function pg_temp.rm(p_case uuid, p_part uuid) returns integer language sql as $$
  select (pg_temp.alloc(p_case, p_part) ->> 'recognizable_minutes')::integer $$;
-- 전에 화면이 쓰던 상한(배정 − 해제).
create function pg_temp.old_max(p_case uuid, p_part uuid) returns integer language sql as $$
  select (pg_temp.alloc(p_case, p_part) ->> 'allocated_minutes')::integer - (pg_temp.alloc(p_case, p_part) ->> 'released_minutes')::integer $$;
create function pg_temp.verify(p_ful uuid, p_case uuid, p_minutes integer, p_cmd uuid default gen_random_uuid()) returns jsonb language sql as $$
  select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', p_ful,
    'recognitions', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', p_minutes))), mt.rev('makeup_fulfillments', p_ful), p_cmd) $$;
create function pg_temp.verify_fails(p_ful uuid, p_case uuid, p_minutes integer, p_code text, p_name text) returns void language sql as $$
  select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', p_ful,
    'recognitions', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', p_minutes))), mt.rev('makeup_fulfillments', p_ful), p_code, p_name) $$;
create function pg_temp.record(p_part uuid, p_minutes integer) returns uuid language sql as $$
  select (mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', p_part, 'status', 'partial',
    'actual_minutes', p_minutes, 'learning_summary', '합성 지도 내용')) ->> 'fulfillment_id')::uuid $$;

-- ① 60분 배정: 참여 전에는 0(실제 지도 분이 없다) → 60분 지도 기록 뒤 60.
create temp table p1 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 60) as id;
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 0, '참여 기록 전에는 인정할 분량이 없다');
create temp table f1 as select pg_temp.record((select id from p1), 60) as id;
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 60, '60분 지도 기록 뒤 60분까지');
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p1)));
select pg_temp.verify_fails((select id from f1), (select a1 from k), 61, 'invalid', '인정할 수 있는 분량보다 1분 많으면 거절(실제 지도 분)');
-- 같은 요청(요청 번호·내용·개정 번호가 같다)을 두 번 보낸다 — 두 번 눌러도 인정은 한 번이다.
create temp table cmd1 as select gen_random_uuid() as id, mt.rev('makeup_fulfillments', (select id from f1)) as rev,
  jsonb_build_object('fulfillment_id', (select id from f1),
    'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 60))) as body;
select mt.eq((mt.cmd(mt.id(22), 'verify', (select body from cmd1), (select rev from cmd1), (select id from cmd1)) ->> 'replayed')::boolean, false, '첫 검토는 새로 처리된다');
select mt.eq(pg_temp.q((select a1 from k)), 'O=60 C=0 R=60', '60분 인정 뒤 O=60');
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 0, '전량 인정 뒤에는 더 인정할 분량이 없다');
select mt.eq((mt.cmd(mt.id(22), 'verify', (select body from cmd1), (select rev from cmd1), (select id from cmd1)) ->> 'replayed')::boolean, true, '같은 요청 재시도는 저장된 결과(replayed)');
select pg_temp.verify_fails((select id from f1), (select a1 from k), 60, 'conflict', '다른 요청으로 다시 검토하면 거절');
select mt.eq((select count(*)::int from public.makeup_recognitions where fulfillment_id = (select id from f1) and kind = 'recognize'), 1, '인정 기록은 1건');

-- ② 반전: 배정이 전부 해제량으로 간다. 전에 화면이 쓰던 상한(배정 − 해제)은 0이지만 검토는 같은 배정을 되잡는다.
select mt.cmd(mt.id(22), 'reverse', jsonb_build_object('fulfillment_id', (select id from f1), 'reason', '합성 정정'), mt.rev('makeup_fulfillments', (select id from f1)));
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=0 R=120', '반전 뒤 의무 복원 · 점유 0(좌석은 되살리지 않는다)');
select mt.eq(pg_temp.old_max((select a1 from k), (select id from p1)), 0, '반전 뒤 "배정 − 해제"는 0이다(전에 입력 상한이 0이 되던 까닭)');
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 60, '반전 뒤에도 인정할 수 있는 분량은 60분');
select mt.eq((pg_temp.alloc((select a1 from k), (select id from p1)) ->> 'release_reason'), 'reversed', '해제 사유는 반전으로 남는다');

-- ③ 그 사이 다른 날짜의 새 예약이 100분을 잡았다 → 되잡을 수 있는 분은 남은 예약 가능량(20분)까지.
create temp table p2 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), array['1','2'], 100) as id;
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=100 R=20', '새 예약이 100분을 잡았다');
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 20, '새 예약이 잡은 분량만큼 줄어든다(60 → 20)');
create temp table f2 as select pg_temp.record((select id from p1), 60) as id;
select mt.ok((select id from f2) <> (select id from f1), '정정은 새 실시 기록(옛 기록은 반전으로 보존)');
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p1)));
select mt.eq(pg_temp.rm((select a1 from k), (select id from p1)), 20, '다시 기록·제출해도 20분');
select pg_temp.verify_fails((select id from f2), (select a1 from k), 21, 'conflict', '1분 더(21분)는 검토가 거절한다 — 새 예약의 분량을 침범하지 않는다');
select pg_temp.verify((select id from f2), (select a1 from k), 20);
select mt.eq((select state from public.makeup_fulfillments where id = (select id from f2)), 'verified', '딱 그 분량(20분)은 검토가 받는다');
select mt.eq(pg_temp.q((select a1 from k)), 'O=100 C=100 R=0', '재인정 뒤 수량 — 새 예약의 점유는 그대로');
select mt.eq((select recognized_minutes || ':' || released_minutes from public.makeup_allocations where participant_id = (select id from p1)), '20:40', '재인정 20 · 나머지 40은 해제로 남는다');
select mt.eq((select status from public.makeup_participants where id = (select id from p2)), 'unknown', '새 예약은 건드리지 않았다');
select mt.eq((select count(*)::int from public.attendance_records), 0, '인정·반전·재인정은 출결을 쓰지 않는다');

-- ④ 실제 지도 분이 배정보다 적으면 실제 분이 상한이다: 60분 배정 · 45분 지도 → 45.
create temp table p3 as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['3','4'], 60) as id;
create temp table f3 as select pg_temp.record((select id from p3), 45) as id;
select mt.eq(pg_temp.rm((select b1 from k), (select id from p3)), 45, '실제 지도 분(45)이 상한');
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p3)));
select pg_temp.verify_fails((select id from f3), (select b1 from k), 46, 'invalid', '46분은 거절');
select pg_temp.verify((select id from f3), (select b1 from k), 45);
select mt.eq(pg_temp.q((select b1 from k)), 'O=75 C=0 R=75', '45분 인정 · 나머지 15분 배정은 자동 해제');

-- ⑤ 범위: 강사는 담당 건의 배정에서 같은 값을 본다. 값은 힌트일 뿐 — 검토 권한은 그대로 원장·관리자만.
select mt.eq((select (x ->> 'recognizable_minutes')::int from jsonb_array_elements(pg_temp.detail(mt.id(25), (select b1 from k)) -> 'allocations') x
  where (x ->> 'participant_id')::uuid = (select id from p3)), pg_temp.rm((select b1 from k), (select id from p3)), '강사도 관리자와 같은 값을 본다');
select mt.cmd_throws(mt.id(25), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'recognitions', '[]'::jsonb),
  mt.rev('makeup_fulfillments', (select id from f3)), 'forbidden', '값을 본다고 검토할 수 있는 것은 아니다');
select count(*) as passed from mt.passed;
rollback;
