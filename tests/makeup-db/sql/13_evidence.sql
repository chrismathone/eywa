-- 실시 증거: 관측과 실제 참여의 분리 · 보고서 연결 검증 (보완 1·3 — MU-025·026·029·069·076 · MU-X02·X12)
-- d(0) = 정규 수업 없는 날 · d(-6) = 반1 정규 수업일(d(1)과 같은 요일).
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 120) as a1,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 120) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-13), 240) as c1;
create function pg_temp.part(p_actor uuid, p jsonb) returns jsonb language sql as $$ select mt.cmd(p_actor, 'participation', p) $$;

-- ① 실제 분은 반드시 명시한다 — 예정 분으로 채우지 않는다.
create temp table p1 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present'), null, 'invalid', '실제 분 없이 왔다 기록 거절(예정 분으로 채우지 않는다)');
-- ② 분만 있고 실시 증거가 없으면 거절.
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110), null, 'evidence_required', '증거 없는 참여 기록 거절');
select mt.eq((select status from public.makeup_participants where id = (select id from p1)), 'unknown', '거절된 참여는 미기록 그대로');
-- ③ 정규 수업이 없는 날의 앵커 반 출결 행은 실시 증거다(출결 훅의 자동 이행 경로).
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(91), mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'makeup', 1, mt.id(25));
create temp table r1 as select pg_temp.part(mt.id(25), jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(91))) as r;
select mt.eq((select r ->> 'evidence_kind' from r1), 'attendance', '비정규일 출결 행 = 실시 증거');
select mt.eq((select evidence_kind || ':' || actual_minutes from public.makeup_fulfillments where participant_id = (select id from p1)), 'attendance:110', '실시 기록에 증거 종류와 명시한 분을 남긴다');
select mt.eq((select status from public.makeup_reservations where student_id = mt.id(61)), 'done', '증거가 있을 때만 예약 행 이행');

-- ④ MU-026 정규 수업일의 출결은 실시 증거가 아니다 — 관측(반영 작업)만 남고 참여·분·예약 행은 그대로.
create temp table p2 as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['5','6'], 110) as id;
select mt.backdate((select session_id from public.makeup_participants where id = (select id from p2)), mt.d(-6));
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(92), mt.id(11), mt.id(51), mt.id(62), mt.d(-6), 'present', 2, mt.id(25));
select mt.eq((select state from public.makeup_projection_jobs where effect_key = 'att:' || (select id from p2)), 'pending', '정규일 출결 = 관측만(pending)');
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p2), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(92)),
  null, 'evidence_required', 'MU-026 정규 출석만으로는 보강 참여를 기록할 수 없다');
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p2), 'status', 'present', 'actual_minutes', 110),
  null, 'evidence_required', 'MU-026 관측된 정규 출결을 자동 연결해 증거로 삼지 않는다');
select mt.eq((select status || ':' || coalesce(actual_minutes::text, 'null') from public.makeup_participants where id = (select id from p2)), 'unknown:null', 'MU-026 참여·실제 분 불변');
select mt.eq((select status from public.makeup_reservations where student_id = mt.id(62)), 'reserved', 'MU-026 예약 행도 이행으로 넘어가지 않는다');
select mt.eq((select state from public.makeup_projection_jobs where effect_key = 'att:' || (select id from p2)), 'pending', 'MU-026 반영 작업은 검증 없이 done이 되지 않는다');
-- ⑤ 수기 실제 확인: 명시한 분 + 지도 근거 글. 정규일 출결은 연결(귀속·시수 대조용)만 된다.
create temp table r2 as select pg_temp.part(mt.id(25), jsonb_build_object('participant_id', (select id from p2), 'status', 'present', 'actual_minutes', 100,
  'attendance_record_id', mt.id(92), 'learning_summary', '합성: 3단원 보충 지도')) as r;
select mt.eq((select r ->> 'evidence_kind' from r2), 'manual', '수기 확인(분 + 지도 근거)');
select mt.eq((select actual_minutes || ':' || attendance_record_id::text from public.makeup_participants where id = (select id from p2)), '100:' || mt.id(92), '명시한 분으로 기록 · 정규 출결 행은 연결만');
select mt.eq((select learning_summary from public.makeup_fulfillments where participant_id = (select id from p2)), '합성: 3단원 보충 지도', '지도 근거를 실시 기록에 남긴다');

-- ⑥ 보고서 증거: 반 없는 보강 보고서 · 실제 강사 작성 · 앵커 반 일치 · 발송 처리 중 아님.
create temp table p3 as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(0), array['3','4'], 110) as id;
insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, class_id, makeup_class_id, makeup, created_by, classnote_status, notes) values
  (mt.id(201), mt.id(11), mt.id(63), mt.d(0), 'math', mt.id(51), null, false, mt.id(25), null, '정규 보고서'),
  (mt.id(202), mt.id(11), mt.id(63), mt.d(0), 'math', null, mt.id(51), true, mt.id(26), null, '보강 보고서');
create function pg_temp.report_fails(p_set text, p_name text) returns void language plpgsql as $$
begin
  execute 'update public.lesson_reports set ' || p_set || ' where id = mt.id(202)';
  perform mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p3), 'status', 'present', 'actual_minutes', 110, 'report_id', mt.id(202)), null, 'invalid', p_name);
end; $$;
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p3), 'status', 'present', 'actual_minutes', 110, 'report_id', mt.id(201)), null, 'invalid', '정규 반 보고서는 보강 증거로 연결 거절');
select pg_temp.report_fails('notes = notes', '다른 강사가 쓴 보고서 연결 거절(소유권)');
-- 작성 계정은 DB가 처음 쓴 사람으로 고정한다(0172a) — 고쳐 써서 소유를 바꿀 수 없다. 실제 강사의 보고서로 다시 쓴다.
update public.lesson_reports set created_by = mt.id(25) where id = mt.id(202);
select mt.eq((select created_by from public.lesson_reports where id = mt.id(202)), mt.id(26), 'MU-X12 보고서 작성 계정은 수정으로 바뀌지 않는다');
delete from public.lesson_reports where id = mt.id(202);
insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, class_id, makeup_class_id, makeup, created_by, classnote_status, notes)
  values (mt.id(202), mt.id(11), mt.id(63), mt.d(0), 'math', null, mt.id(51), true, mt.id(25), null, '보강 보고서');
select pg_temp.report_fails('makeup_class_id = mt.id(52)', '앵커 반이 다른 보고서 연결 거절');
select pg_temp.report_fails('makeup_class_id = mt.id(51), makeup = false', '보강 표시가 없는 보고서 연결 거절');
select pg_temp.report_fails('makeup = true, classnote_status = ''processing''', '발송 처리 중인 보고서 연결 거절');
select pg_temp.report_fails('classnote_status = ''recall_requested''', '회수 요청 중인 보고서 연결 거절');
select pg_temp.report_fails('classnote_status = ''recalled''', '회수된 보고서 연결 거절');
update public.lesson_reports set classnote_status = 'success' where id = mt.id(202);
-- MU-069·X12 데스크 대리입력: 입력자 = 데스크, 실제 강사 = 회차 강사, 보고서 소유는 그대로.
create temp table r3 as select pg_temp.part(mt.id(27), jsonb_build_object('participant_id', (select id from p3), 'status', 'present', 'actual_minutes', 110, 'report_id', mt.id(202))) as r;
select mt.eq((select r ->> 'evidence_kind' from r3), 'report', '이미 보낸 보강 보고서는 증거로 연결된다(보고서는 고치지 않는다)');
select mt.eq((select recorded_by::text || ':' || actual_teacher_id::text || ':' || report_id::text from public.makeup_fulfillments where participant_id = (select id from p3)),
  mt.id(27)::text || ':' || mt.id(25)::text || ':' || mt.id(202)::text, 'MU-069 입력자와 실제 강사를 따로 남긴다');
select mt.eq((select created_by::text || ':' || classnote_status || ':' || notes from public.lesson_reports where id = mt.id(202)), mt.id(25)::text || ':success:보강 보고서', 'MU-X12 연결이 보고서 소유·발송 상태·본문을 바꾸지 않는다');
-- 제출(submit)도 같은 보고서 검증을 지난다.
select mt.cmd_throws(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p1), 'report_id', mt.id(201)), null, 'invalid', '제출 때도 정규 반 보고서 연결 거절');

-- ⑦ MU-076 자기 검토는 첫 출시에서 항상 거절(정책 값과 무관 · 대리입력으로도 우회 불가).
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p3)));
create temp table f3 as select id, revision from public.makeup_fulfillments where participant_id = (select id from p3);
update public.users set system_role = 'admin' where id = mt.id(25);
select mt.cmd_throws(mt.id(25), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'status', 'returned', 'reason', '본인 보완 요청'),
  (select revision from f3), 'forbidden', 'MU-076 실제 강사는 직접 명령으로 본인 기록을 보완 요청할 수 없다');
select mt.cmd_throws(mt.id(25), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select c1 from k), 'minutes', 110))),
  (select revision from f3), 'forbidden', 'MU-076 실제 강사의 자기 검토 거절');
select mt.ok((mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select c1 from k), 'minutes', 110))),
  (select revision from f3)) ->> 'id') is not null, '다른 관리자의 검토는 통과');
select count(*) as passed from mt.passed;
rollback;
