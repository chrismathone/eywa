-- 예약 확정의 서버 재검증 (MU-015·016·017·018·019·038·070 · MU-X01·X02·X03·X18)
begin;
select mt.seed_on();
-- 학생A는 반1·반2(수학) 둘 다 다닌다 → 원결석 두 건. 학생D·E는 반2.
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(61), mt.id(52), mt.d(-200));
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 240) as a1,
  mt.approved_case(mt.id(61), mt.id(52), mt.d(-5), 120) as a2,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-6), 120) as b1,
  mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1,
  mt.approved_case(mt.id(65), mt.id(52), mt.d(-5), 120) as e1;
create function pg_temp.rsv(p_actor uuid, p_student uuid, p_case uuid, p_date date, p_periods text, p_teacher uuid, p_room uuid, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select mt.cmd(p_actor, 'reserve', jsonb_build_object('student_id', p_student, 'session_date', p_date, 'period_ids', p_periods::jsonb,
    'teacher_id', p_teacher, 'classroom_id', p_room, 'allocations', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', 50))) || p_extra) $$;
create function pg_temp.rsv_fails(p_actor uuid, p_student uuid, p_case uuid, p_date date, p_periods text, p_teacher uuid, p_room uuid, p_extra jsonb, p_code text, p_name text)
returns void language sql as $$
  select mt.cmd_throws(p_actor, 'reserve', jsonb_build_object('student_id', p_student, 'session_date', p_date, 'period_ids', p_periods::jsonb,
    'teacher_id', p_teacher, 'classroom_id', p_room, 'allocations', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', 50))) || p_extra, null, p_code, p_name) $$;

-- MU-018 교시·시각 위조 거절(학원 설정 교시표에서만).
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["99"]', mt.id(25), mt.id(41), '{}', 'invalid', 'MU-018 교시표에 없는 교시 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1","3"]', mt.id(25), mt.id(41), '{}', 'invalid', 'MU-018 이어지지 않은 교시 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(25), mt.id(41), '{"start_time":"03:00","end_time":"04:00"}', 'invalid', 'MU-018 자유 시각 위조 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(-1), '["1"]', mt.id(25), mt.id(41), '{}', 'invalid', '지난 날짜 예약 거절');
-- 주말은 주말 교시표(과목 무관) · 수학 평일 이름은 반교시 표기 — 기존 예약과 같은 규칙.
select mt.eq((select to_char(o_start, 'HH24:MI') || '~' || to_char(o_end, 'HH24:MI') || ' ' || o_label from makeup_private.resolve_periods(mt.id(11), 'math', date '2026-10-10', array['2','1'])), '09:00~11:00 주말 1교시~2교시', '주말 교시표·이름');
select mt.eq((select to_char(o_start, 'HH24:MI') || '~' || to_char(o_end, 'HH24:MI') || ' ' || o_label from makeup_private.resolve_periods(mt.id(11), 'math', date '2026-10-07', array['3','4'])), '16:20~18:10 2-1~2-2', '수학 평일 반교시 이름(기본 교시표)');
select mt.eq((select count(*)::int from makeup_private.period_table(mt.id(11), 'english', date '2026-10-07')), 11, '영어 내장 교시표 11교시');
-- 강사·강의실·정원: 생략·비재직·정원 미설정은 거절(요청값으로 메우지 않는다).
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', null, mt.id(41), '{}', 'invalid', '강사 미지정 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(29), mt.id(41), '{}', 'invalid', '비재직 강사 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(25), mt.id(43), '{"capacity":3}', 'invalid', '강의실 정원 미설정 → 요청 정원으로 메우지 않고 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(25), mt.id(41), '{"capacity":9}', 'invalid', '강의실 정원보다 큰 회차 정원 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(25), mt.id(49), '{}', 'invalid', 'MU-023 다른 지점 강의실 거절');
select pg_temp.rsv_fails(mt.id(25), mt.id(61), (select a1 from k), mt.d(3), '["1"]', mt.id(26), mt.id(41), '{}', 'forbidden', '강사는 본인이 맡는 보강만 잡는다');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select b1 from k), mt.d(3), '["1"]', mt.id(25), mt.id(41), '{}', 'invalid', 'MU-038 다른 학생의 케이스 결합 거절');

-- MU-016 학생의 정규 수업 시간과 겹치면 거절, 앞뒤로 붙는 것은 허용 · MU-X02 같은 날 같은 강사 정규+1보강 허용.
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(1), '["4","5"]', mt.id(25), mt.id(41), '{}', 'conflict', 'MU-016 정규 수업과 겹치는 시간 거절');
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a1 from k), mt.d(1), '["5"]', mt.id(26), mt.id(42), '{}', 'conflict', 'MU-X03 같은 날 정규 강사와 다른 보강 강사 거절');
create temp table r1 as select pg_temp.rsv(mt.id(22), mt.id(61), (select a1 from k), mt.d(1), '["5"]', mt.id(25), mt.id(41)) as r;
select mt.ok((select (r ->> 'id') is not null from r1), 'MU-X02 같은 날 같은 강사의 정규 + 보강 1건 허용');
-- MU-X01 같은 날 같은 과목 둘째 보강은 앵커·시각·강사가 달라도 거절(세션·보고서를 쓰기 전).
select pg_temp.rsv_fails(mt.id(22), mt.id(61), (select a2 from k), mt.d(1), '["7"]', mt.id(25), mt.id(41), '{}', 'conflict', 'MU-X01 같은 날 둘째 보강 거절');
select mt.eq((select count(*)::int from public.makeup_sessions), 1, 'MU-X01 거절된 예약은 회차를 남기지 않는다');

-- MU-017·X18 강사: 같은 시각 다른 강의실은 거절, 같은 강의실 합류는 정원 안에서 허용.
select pg_temp.rsv_fails(mt.id(22), mt.id(64), (select d1 from k), mt.d(1), '["3","4"]', mt.id(25), mt.id(42), '{}', 'conflict', 'MU-017 강사의 정규 수업과 다른 강의실 동시 배정 거절');
create temp table r2 as select pg_temp.rsv(mt.id(22), mt.id(64), (select d1 from k), mt.d(1), '["3","4"]', null, null, jsonb_build_object('class_id', mt.id(51))) as r;
select mt.eq((select (r -> 'session' ->> 'teacher_id')::uuid from r2), mt.id(25), '합류 반만 주면 그 교시의 실효 강사를 서버가 정한다');
select mt.eq((select (r -> 'session' ->> 'classroom_id')::uuid from r2), mt.id(41), '합류 반만 주면 그 교시의 실효 강의실을 서버가 정한다');
-- 1강의실 정원 4 = 정규 3명 + 보강 1명. 한 명 더 합류하면 초과.
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('session_id', (select r ->> 'session_id' from r2), 'student_id', mt.id(65),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select e1 from k), 'minutes', 50))), null, 'conflict', 'MU-X18 정규 재원 + 보강이 강의실 정원을 넘으면 거절');

-- 합반: 같은 회차에 다른 학생 합류 · MU-015 마지막 자리(회차 정원 2).
create temp table r3 as select pg_temp.rsv(mt.id(22), mt.id(64), (select d1 from k), mt.d(3), '["1","2"]', mt.id(25), mt.id(41), '{"capacity":2}') as r;
select mt.ok((mt.cmd(mt.id(22), 'reserve', jsonb_build_object('session_id', (select r ->> 'session_id' from r3), 'student_id', mt.id(65),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select e1 from k), 'minutes', 50)))) ->> 'id') is not null, '같은 회차에 다른 학생 합류');
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('session_id', (select r ->> 'session_id' from r3), 'student_id', mt.id(62),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 50))), null, 'conflict', 'MU-015 회차 정원이 차면 거절');
select mt.eq((select count(*)::int from public.makeup_participants where session_id = (select (r ->> 'session_id')::uuid from r3)), 2, 'MU-015 정원 초과 없음');
-- MU-016 같은 학생이 같은 시각 다른 보강에 있으면 거절(다른 과목이어도 — 여기서는 같은 과목이라 하루 상한이 먼저 막는다).
select pg_temp.rsv_fails(mt.id(22), mt.id(64), (select d1 from k), mt.d(3), '["2"]', mt.id(26), mt.id(42), '{}', 'conflict', 'MU-016 같은 날 다른 보강 거절');

-- 기존 기록과의 충돌: 연결 안 된 기존 예약 · 반 없는 같은 과목 보고서 · 기존 보강 세션.
insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(11), mt.id(62), mt.id(51), mt.d(-6), mt.d(4), '10:00', '11:00');
select pg_temp.rsv_fails(mt.id(22), mt.id(62), (select b1 from k), mt.d(4), '["1"]', mt.id(25), mt.id(41), '{}', 'conflict', '연결 안 된 기존 예약이 있으면 새 일정 거절(연결을 먼저)');
insert into public.lesson_reports (tenant_id, student_id, report_date, subject, makeup) values (mt.id(11), mt.id(62), mt.d(5), 'math', true);
select pg_temp.rsv_fails(mt.id(22), mt.id(62), (select b1 from k), mt.d(5), '["1"]', mt.id(25), mt.id(41), '{}', 'conflict', 'MU-X01 반 없는 같은 과목 보고서가 있으면 거절');
insert into public.onescreen_daily_sessions (tenant_id, student_id, session_date, class_id, subject_progress, updated_by)
  values (mt.id(11), mt.id(62), mt.d(6), mt.id(51), '{"makeup::math":{"x":1}}', mt.id(25));
select pg_temp.rsv_fails(mt.id(22), mt.id(62), (select b1 from k), mt.d(6), '["1"]', mt.id(25), mt.id(41), '{}', 'conflict', '기존 보강 세션이 있으면 거절');

-- MU-019 교시표가 바뀌어도 잡아 둔 회차의 시각은 그대로(스냅샷).
create temp table snap as select start_time, end_time from public.makeup_sessions where id = (select (r ->> 'session_id')::uuid from r3);
update public.tenant_settings set data = jsonb_set(data, '{operations}', '{"weekdayPeriods":[{"label":"가","startTime":"10:00","endTime":"11:00"}],"weekendPeriods":[{"label":"나","startTime":"10:00","endTime":"11:00"}]}') where tenant_id = mt.id(11);
select mt.ok((select (s.start_time, s.end_time) = (select start_time, end_time from snap) from public.makeup_sessions s where s.id = (select (r ->> 'session_id')::uuid from r3)), 'MU-019 교시표 변경 뒤에도 회차 시각 스냅샷 유지');
select pg_temp.rsv_fails(mt.id(22), mt.id(62), (select b1 from k), mt.d(7), '["2"]', mt.id(25), mt.id(41), '{}', 'invalid', '바뀐 교시표에 없는 교시는 거절(설정이 단일 소스)');
select mt.eq((pg_temp.rsv(mt.id(22), mt.id(62), (select b1 from k), mt.d(7), '["1"]', mt.id(25), mt.id(41)) -> 'session' ->> 'start_time'), '10:00', '새 예약은 바뀐 교시표의 시각');

-- MU-070 앵커 반이 유효하지 않으면(학생이 원반을 떠남) 다른 반으로 돌리지 않고 대사 큐로.
update public.enrollments set end_date = mt.d(-1) where student_id = mt.id(65) and class_id = mt.id(52);
create temp table r4 as select pg_temp.rsv(mt.id(22), mt.id(65), (select e1 from k), mt.d(8), '["1"]', mt.id(25), mt.id(41)) as r;
select mt.ok((select anchor_class_id is null from public.makeup_participants where id = (select (r ->> 'id')::uuid from r4)), 'MU-070 유효한 앵커가 없으면 비워 둔다');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'anchor_missing' and state = 'open'), 1, 'MU-070 연결 결정 대사 생성');
select mt.eq((select count(*)::int from public.makeup_reservations r where r.student_id = mt.id(65) and r.makeup_date = mt.d(8)), 0, 'MU-070 앵커 없이는 출결 화면용 예약 행을 만들지 않는다');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from public.makeup_reconciliation where kind = 'anchor_missing'),
  'note', '합성', 'anchor_class_id', mt.id(52)), 1, 'invalid', 'MU-070 그날 다니지 않는 반은 앵커로 못 고른다');
-- 강사 범위: 본인이 맡는 본인 범위의 건은 직접 잡고 취소한다. 남의 회차는 취소하지 못한다.
create temp table r5 as select pg_temp.rsv(mt.id(25), mt.id(61), (select a1 from k), mt.d(9), '["1"]', mt.id(25), mt.id(41)) as r;
select mt.ok((select (r ->> 'id') is not null from r5), '강사가 담당 반 건을 본인 수업으로 예약');
select mt.cmd_throws(mt.id(26), 'cancel', jsonb_build_object('participant_id', (select r ->> 'id' from r5), 'reason', '합성'),
  mt.rev('makeup_participants', (select (r ->> 'id')::uuid from r5)), 'forbidden', 'MU-036 다른 강사의 일정 취소 거절');
select mt.ok((mt.cmd(mt.id(25), 'cancel', jsonb_build_object('participant_id', (select r ->> 'id' from r5), 'reason', '합성 취소'),
  mt.rev('makeup_participants', (select (r ->> 'id')::uuid from r5))) ->> 'id') is not null, '강사가 본인 일정 취소');
-- 강사 예약 기한(결석한 달의 다음 달 말일) 경계 — makeupDeadlineOf와 같은 식.
select mt.ok(makeup_private.within_teacher_deadline(date '2026-09-01', date '2026-10-31')
  and not makeup_private.within_teacher_deadline(date '2026-09-30', date '2026-11-01')
  and makeup_private.within_teacher_deadline(date '2026-12-15', date '2027-01-31')
  and makeup_private.within_teacher_deadline(date '2026-09-30', date '2026-09-10'), '강사 기한 경계(달 기준 · 해 넘김 · 선보강 통과)');
select count(*) as passed from mt.passed;
rollback;
