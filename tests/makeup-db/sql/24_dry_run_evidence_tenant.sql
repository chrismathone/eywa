-- 가져오기 미리 보기: B = 출결 + 유효한 보강 보고서 **둘 다** · 다른 지점을 가리키는 예약은 보이지도 연결되지도 않는다 (MU-023·054·056)
-- 예약 표(0264a)의 FK는 학생·반의 id만 본다 — 지점까지 묶지 않는다. 그래서 "이 지점 예약인데 학생·반은 다른 지점 것"인 행이
-- 만들어질 수 있다(오래된 데이터·조작). 그런 행은 미리 보기·미연결 근거에 나오지 않고 연결도 거절돼야 한다.
begin;
select mt.seed_on();
select mt.login(null);
insert into public.students (id, tenant_id, name) select mt.id(70 + n), mt.id(11), '검증학생' || chr(64 + n) from generate_series(1, 15) n;
insert into public.enrollments (tenant_id, student_id, class_id, start_date) select mt.id(11), mt.id(70 + n), mt.id(51), mt.d(-200) from generate_series(1, 15) n;
create function pg_temp.att(p_id integer, p_student integer, p_taught uuid default null, p_ago interval default '2 hours') returns uuid language sql as $$
  insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, taught_by, recorded_at)
    values (mt.id(p_id), mt.id(11), mt.id(51), mt.id(p_student), mt.d(-1), 'makeup', 1, mt.id(25), p_taught, now() - p_ago) returning id $$;
create function pg_temp.report(p_id integer, p_student integer, p_by uuid default mt.id(25), p_status text default null, p_class uuid default null,
  p_makeup boolean default true, p_anchor uuid default mt.id(51)) returns void language sql as $$
  insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, class_id, makeup, makeup_class_id, created_by, classnote_status)
    values (mt.id(p_id), mt.id(11), mt.id(p_student), mt.d(-1), 'math', p_class, p_makeup, p_anchor, p_by, p_status) $$;
create function pg_temp.done(p_id integer, p_student uuid, p_class uuid, p_att uuid default null) returns void language sql as $$
  insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status, done_at, attendance_record_id)
    values (mt.id(p_id), mt.id(11), p_student, p_class, mt.d(-6), mt.d(-1), '10:00', '11:00', 'done', now(), p_att) $$;
create function pg_temp.dry(p_actor uuid, p jsonb default '{"page_size":200}') returns jsonb language sql as $$ select mt.run(p_actor, format('select public.makeup_legacy_dry_run(%L::jsonb)', p)) $$;
create function pg_temp.g(p_id integer) returns text language sql as $$
  select x ->> 'evidence_grade' from jsonb_array_elements(pg_temp.dry(mt.id(22)) -> 'rows') x where (x ->> 'id')::uuid = mt.id(p_id) $$;
create function pg_temp.note(p_id integer) returns text language sql as $$
  select x ->> 'review_note' from jsonb_array_elements(pg_temp.dry(mt.id(22)) -> 'rows') x where (x ->> 'id')::uuid = mt.id(p_id) $$;

-- 이행(done) 예약 14건 — 근거의 조합만 다르다. (예약 id 2xx = 학생 7x)
select pg_temp.done(201, mt.id(71), mt.id(51), pg_temp.att(301, 71)); select pg_temp.report(501, 71);                       -- 출결 + 보고서(발송 전)
select pg_temp.done(202, mt.id(72), mt.id(51), pg_temp.att(302, 72)); select pg_temp.report(502, 72, mt.id(25), 'success');  -- 출결 + 보낸 보고서
select pg_temp.done(203, mt.id(73), mt.id(51), pg_temp.att(303, 73));                                                         -- 출결만
select pg_temp.done(204, mt.id(74), mt.id(51)); select pg_temp.report(504, 74);                                               -- 보고서만
select pg_temp.done(205, mt.id(75), mt.id(51), pg_temp.att(305, 75)); select pg_temp.report(505, 75, mt.id(25), 'recalled');   -- 회수된 보고서
select pg_temp.done(206, mt.id(76), mt.id(51), pg_temp.att(306, 76)); select pg_temp.report(506, 76, mt.id(25), 'processing'); -- 발송 처리 중
select pg_temp.done(207, mt.id(77), mt.id(51), pg_temp.att(307, 77)); select pg_temp.report(507, 77, mt.id(25), 'failed');     -- 발송 실패
select pg_temp.done(208, mt.id(78), mt.id(51), pg_temp.att(308, 78)); select pg_temp.report(508, 78, mt.id(26));               -- 그 반을 맡지 않은 강사가 쓴 보고서
select pg_temp.done(209, mt.id(79), mt.id(51), pg_temp.att(309, 79, mt.id(26))); select pg_temp.report(509, 79, mt.id(26));    -- 실제 가르친 강사(귀속)가 쓴 보고서
select pg_temp.done(210, mt.id(80), mt.id(51), pg_temp.att(310, 80)); select pg_temp.report(510, 80, mt.id(25), null, mt.id(51), false, null); -- 정규 반 보고서
select pg_temp.done(211, mt.id(81), mt.id(51), pg_temp.att(311, 81)); select pg_temp.report(511, 81, mt.id(25), null, null, true, mt.id(52));  -- 보강 반이 다른 보고서
select pg_temp.done(212, mt.id(82), mt.id(51), pg_temp.att(312, 82)); select pg_temp.report(512, 82); delete from public.lesson_reports where id = mt.id(512); -- 지워진 보고서
select pg_temp.done(213, mt.id(83), mt.id(51), pg_temp.att(313, 83, null, '3 hours')); select pg_temp.report(513, 83);         -- 연결된 출결이 정정으로 덮임
insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, recorded_by) values (mt.id(11), mt.id(51), mt.id(83), mt.d(-1), 'makeup', 1, mt.id(25));
select pg_temp.done(214, mt.id(84), mt.id(51), mt.id(301)); select pg_temp.report(514, 84);                                    -- 다른 학생의 출결 행을 가리킴
-- 다른 지점(가상학원 나: 학생 69 · 반 59)을 가리키는 예약 — FK만으로는 만들어진다.
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(399), mt.id(12), mt.id(59), mt.id(69), mt.d(-1), 'makeup', 1, mt.id(31));
select pg_temp.done(221, mt.id(69), mt.id(59)); select pg_temp.done(222, mt.id(61), mt.id(59)); select pg_temp.done(223, mt.id(69), mt.id(51));
select pg_temp.done(224, mt.id(85), mt.id(51), mt.id(399)); select pg_temp.report(524, 85);                                    -- 다른 지점의 출결 행을 가리킴
create temp table snap as select (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.makeup_reservations r) as resv,
  (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.attendance_records r) as att,
  (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.lesson_reports r) as rep,
  (select count(*) from public.makeup_cases) + (select count(*) from public.makeup_legacy_maps) + (select count(*) from public.makeup_case_sources)
    + (select count(*) from public.makeup_reconciliation) + (select count(*) from public.makeup_projection_jobs) + (select count(*) from public.makeup_events) as ledger;

-- ① B는 "이행 + 그 칸의 최신 유효 출결 + 유효한 보강 보고서" 셋이 다 있을 때만이다. 하나만 있으면 C.
select mt.eq(pg_temp.g(201) || pg_temp.g(202) || pg_temp.g(209), 'BBB', 'MU-054 출결 + 보고서(발송 전 · 보낸 것 · 귀속 강사가 쓴 것) → B');
select mt.eq(pg_temp.g(203) || pg_temp.g(204), 'CC', 'MU-056 근거가 하나뿐(출결만 · 보고서만)이면 B가 아니라 C');
select mt.eq(pg_temp.g(205) || pg_temp.g(206) || pg_temp.g(207), 'CCC', '회수된 · 발송 처리 중인 · 발송 실패한 보고서는 근거가 아니다 → C');
select mt.eq(pg_temp.g(208) || pg_temp.g(210) || pg_temp.g(211) || pg_temp.g(212), 'CCCC', '그 반을 맡지 않은 강사의 보고서 · 정규 반 보고서 · 보강 반이 다른 보고서 · 지워진 보고서 → C');
select mt.eq(pg_temp.g(213) || pg_temp.g(214) || pg_temp.g(224), 'CCC', '정정으로 덮인 출결 · 다른 학생의 출결 · 다른 지점의 출결을 가리키면(보고서가 있어도) C');
select mt.ok(pg_temp.note(203) like '%보고서%' and pg_temp.note(204) like '%출결%' and pg_temp.note(205) like '%보고서%', '빠진 근거가 무엇인지 적는다');
select mt.eq((pg_temp.dry(mt.id(22)) -> 'counts')::text, '{"A": 0, "B": 3, "C": 12, "D": 0, "E": 0}', '등급별 수: B 3 · C 12(합 = 전체 15)');
-- 이미 다른 보강의 실시 기록에 연결된 보고서는 근거로 다시 쓸 수 없다(검증 전용 표식으로 합성한 참여·실시 기록).
select mt.as_command();
insert into public.makeup_sessions (id, tenant_id, teacher_id, classroom_id, subject_key, session_date, start_time, end_time, created_by)
  values (mt.id(601), mt.id(11), mt.id(25), mt.id(41), 'math', mt.d(-1), '14:00', '15:00', mt.id(22));
insert into public.makeup_participants (id, tenant_id, session_id, student_id, subject_key, session_date, planned_minutes, anchor_class_id)
  values (mt.id(602), mt.id(11), mt.id(601), mt.id(72), 'math', mt.d(-1), 60, mt.id(51));
insert into public.makeup_fulfillments (tenant_id, participant_id, report_id, evidence_kind, actual_minutes, effect_key) values (mt.id(11), mt.id(602), mt.id(502), 'report', 60, 'ful:synthetic');
select mt.end_command();
select mt.eq(pg_temp.g(202) || ':' || (pg_temp.note(202) like '%보고서%'), 'C:true', '다른 보강에 이미 연결된 보고서는 근거가 아니다 → B였던 예약이 C로');

-- ② 다른 지점을 가리키는 예약 3건은 미리 보기·미연결 근거에 나오지 않고, 다른 지점의 이름·번호가 새지 않는다.
create temp table out as select pg_temp.dry(mt.id(22)) as d, mt.run(mt.id(22), 'select public.makeup_candidates(''{"kind":"legacy","page_size":100}'')') as c;
select mt.eq((select (d ->> 'total') || ':' || (c ->> 'total') from out), '15:15', 'MU-023 다른 지점의 학생·반을 가리키는 예약은 목록에 없다(미리 보기 15 · 미연결 근거 15)');
select mt.ok((select (d::text || c::text) !~ ('나학생|나 수학반|' || mt.id(69) || '|' || mt.id(59) || '|' || mt.id(221) || '|' || mt.id(222) || '|' || mt.id(223)) from out),
  '다른 지점의 학생 이름·반 이름·번호가 출력 어디에도 없다');
select mt.cmd(mt.id(31), 'configure', '{"mode":"on"}'::jsonb);
select mt.eq((pg_temp.dry(mt.id(31)) ->> 'total') || ':' || (mt.run(mt.id(31), 'select public.makeup_candidates(''{"kind":"legacy"}'')') ->> 'total'), '0:0',
  '그 다른 지점의 원장에게도 보이지 않는다(예약 행은 가상학원 가의 것이다)');
-- ③ 연결(link_legacy)도 거절한다 — 다른 지점의 학생·반을 원장에 들이지 않고, 예약과 맞지 않는 출결 행도 들이지 않는다.
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(221)), null, 'invalid', '학생·반이 모두 다른 지점인 예약 연결 거절');
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(222)), null, 'invalid', '반만 다른 지점인 예약 연결 거절');
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(223)), null, 'invalid', '학생만 다른 지점인 예약 연결 거절');
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(224)), null, 'invalid', '다른 지점의 출결 행을 가리키는 예약 연결 거절');
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(214)), null, 'invalid', '다른 학생의 출결 행을 가리키는 예약 연결 거절');
select mt.cmd_throws(mt.id(31), 'link_legacy', jsonb_build_object('source_id', mt.id(221)), null, 'not_found', '다른 지점의 원장은 이 예약을 찾지도 못한다');
-- ④ 여기까지 아무것도 쓰지 않았다(미리 보기·목록 조회·거절된 연결 6건).
select mt.ok((select s.resv = (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.makeup_reservations r)
  and s.att = (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.attendance_records r)
  and s.rep = (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.lesson_reports r)
  and s.ledger + 1 = (select count(*) from public.makeup_cases) + (select count(*) from public.makeup_legacy_maps) + (select count(*) from public.makeup_case_sources)
    + (select count(*) from public.makeup_reconciliation) + (select count(*) from public.makeup_projection_jobs) + (select count(*) from public.makeup_events) from snap s),
  'MU-054 운영 쓰기 0 — 예약·출결·보고서 불변, 원장은 다른 지점을 켠 설정 이벤트 1줄뿐');
-- ⑤ B는 후보일 뿐이다: 연결해도 참여는 미기록이고 실시 기록·인정은 생기지 않는다(검토는 사람이 한다).
create temp table lk as select mt.cmd(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(201),
  'expected_source_hash', (select x ->> 'source_hash' from out, jsonb_array_elements(d -> 'rows') x where (x ->> 'id')::uuid = mt.id(201)))) as r;
select mt.eq((select p.status || ':' || p.attendance_record_id::text from public.makeup_participants p where p.id = (select (r ->> 'participant_id')::uuid from lk)) || ':' ||
  (select count(*) from public.makeup_fulfillments f where f.participant_id = (select (r ->> 'participant_id')::uuid from lk)) || ':' || (select count(*) from public.makeup_recognitions) || ':' ||
  (select count(*) from public.makeup_reconciliation where kind = 'legacy_done_review' and state = 'open'), 'unknown:' || mt.id(301) || ':0:0:1',
  'MU-056 B 예약을 연결해도 자동 인정 없음(참여 미기록 · 실시 기록 0 · 인정 0 · 이행 검토 항목 1)');
select count(*) as passed from mt.passed;
rollback;
