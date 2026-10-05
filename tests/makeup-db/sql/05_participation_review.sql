-- 참여·실시·검토의 귀속과 대사 (MU-010·025·026·033·064·069·076·079 · MU-X12·X16·X17·X19)
-- d(0) = 정규 수업 없는 날: 예상 시수 = 보강분만(110분 → 1.0).
begin;
select mt.seed_on();
-- 학생A의 반1 결석 두 건(다른 날) → 한 참여에 두 원결석 배분(N:M).
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 60) as a1,
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 60) as a2,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-6), 120) as b1;
create temp table p1 as select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(0),
  'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 55), jsonb_build_object('case_id', (select a2 from k), 'minutes', 55)))) ->> 'id')::uuid as id;
create function pg_temp.job(p uuid) returns text language sql as $$ select state from public.makeup_projection_jobs where effect_key = 'att:' || p $$;
create function pg_temp.recon(p_kind text) returns public.makeup_reconciliation language sql as $$ select r from public.makeup_reconciliation r where r.kind = p_kind order by r.created_at desc limit 1 $$;
-- MU-064 한 회차 복수 원결석: 출결 화면용 예약 1건 + 연결 행 2건, 대표 결석일 = 가장 이른 원수업일.
select mt.eq((select count(*)::int || ':' || min(absence_date) from public.makeup_reservations), '1:' || mt.d(-13), 'MU-064 예약 행 1건 · 대표 결석일 = 가장 이른 원수업일');
select mt.eq((select count(*)::int from public.makeup_legacy_maps where state = 'active'), 2, 'MU-064 연결 행은 케이스 수만큼');

-- MU-X16 키오스크 등원(행위자 없는 출결 저장)은 그대로 성공하고, 보강 효과는 관측(pending)으로만 남는다.
select mt.login(null);
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units)
  values (mt.id(91), mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'present', 1.5);
select mt.eq(pg_temp.job((select id from p1)), 'pending', 'MU-X16 정규 출결 저장 성공 · 보강 효과는 pending');
select mt.eq((select status || ':' || (select count(*) from public.makeup_fulfillments) from public.makeup_participants where id = (select id from p1)), 'unknown:0', 'MU-026 출결만으로 참여·실시 기록이 생기지 않는다');
-- 관측 트리거가 안에서 실패해도 출결 저장은 성공하고, 실패는 그 학생·그날에 닿는 케이스를 적은 작업으로 남는다.
alter table public.makeup_reconciliation rename column dedupe_key to dedupe_key_broken;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units)
  values (mt.id(90), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'present', 1);
alter table public.makeup_reconciliation rename column dedupe_key_broken to dedupe_key;
select mt.eq((select count(*)::int from public.attendance_records where id = mt.id(90)), 1, 'MU-X16 관측 실패에도 정규 출결 저장은 성공');
select mt.eq((select state || ':' || (case_ids = array[(select a1 from k)])::text from public.makeup_projection_jobs where effect_key = 'att-observe-failed:' || mt.id(90)),
  'failed:true', 'MU-X16 실패는 닿는 케이스(a1)를 적은 failed 작업으로 남는다(0건·완료로 위장하지 않음)');

-- MU-069·X12 데스크 대리입력: 입력자 = 데스크, 실제 강사 = 회차의 강사. 타반 강사는 거절.
select mt.cmd_throws(mt.id(26), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성'), null, 'forbidden', 'MU-036 배정되지 않은 강사의 참여 입력 거절');
select mt.cmd_throws(mt.id(27), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성', 'teacher_id', mt.id(27)), null, 'invalid', 'MU-069 데스크를 실제 강사로 바꿔 넣기 거절');
create temp table pr as select mt.cmd(mt.id(27), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110,
  'attendance_record_id', mt.id(91), 'manual_units', 1.5, 'expected_makeup_units', 1.5, 'expected_total_units', 1.5, 'effect_key', 'hook:abc')) as r;
select mt.eq((select r ->> 'effect_key' from pr), 'hook:abc', '요청이 보낸 효과 키를 그대로 돌려준다');
select mt.eq((select recorded_by::text || ':' || actual_teacher_id::text from public.makeup_fulfillments), mt.id(27)::text || ':' || mt.id(25)::text, 'MU-069 입력자와 실제 강사를 따로 남긴다');
-- MU-X19 클라이언트가 예상 시수를 1.5로 보내도 서버가 다시 계산한다(1.0) → 수기 1.5와 어긋남 = 실패 + 대사.
select mt.eq((select (r ->> 'projection_state') || ':' || (r -> 'verification' ->> 'code') || ':' || (r -> 'evidence' ->> 'session_units') || ':' || (r -> 'evidence' ->> 'actual_teacher_id') from pr),
  'failed:units_mismatch:1.5:' || mt.id(25), 'MU-X19 명령이 성공해도 반영은 failed — 응답에 검증 결과와 증거를 싣는다');
select mt.eq(pg_temp.job((select id from p1)), 'failed', 'MU-X16·X19 반영 작업은 명령 성공만으로 done이 되지 않는다');
select mt.eq((select r.kind || ':' || r.blocks_close || ':' || (r.detail ->> 'actual_units') || ':' || (r.detail ->> 'expected_units') || ':' || (r.detail -> 'client_claim' ->> 'expected_total_units')
  from pg_temp.recon('units_mismatch') r), 'units_mismatch:true:1.5:1.0:1.5', 'MU-X19 수기 시수 차이 대사(서버 계산 1.0 · 클라이언트 주장은 주장으로만 남는다)');
select mt.eq((select session_units from public.attendance_records where id = mt.id(91)), 1.5, 'MU-X19 수기 시수는 그대로(명령은 출결 행을 쓰지 않는다)');
-- 보고서 연결: 다른 학생의 보고서는 거절, 맞는 보강 보고서는 연결(보고서 행은 쓰지 않는다).
insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, makeup, makeup_class_id, created_by, notes)
  values (mt.id(95), mt.id(11), mt.id(61), mt.d(0), 'math', true, mt.id(51), mt.id(25), '합성 보고서'),
         (mt.id(96), mt.id(11), mt.id(62), mt.d(-20), 'math', true, mt.id(51), mt.id(25), '다른 학생');
select mt.cmd_throws(mt.id(27), 'submit', jsonb_build_object('participant_id', (select id from p1), 'report_id', mt.id(96)), null, 'invalid', 'MU-038 다른 학생의 보고서 연결 거절');
select mt.cmd(mt.id(27), 'submit', jsonb_build_object('participant_id', (select id from p1), 'report_id', mt.id(95)));
select mt.eq((select created_by::text || ':' || notes from public.lesson_reports where id = mt.id(95)), mt.id(25)::text || ':합성 보고서', 'MU-X12 대리 제출이 보고서 소유·본문을 바꾸지 않는다');
select mt.throws('delete from public.lesson_reports where id = mt.id(95)', 'P0001', '연결된 보고서 직접 삭제 거절');
update public.lesson_reports set notes = '본문 수정' where id = mt.id(95);
select mt.eq((select notes from public.lesson_reports where id = mt.id(95)), '본문 수정', '연결된 보고서의 본문 수정은 종전 그대로');

-- MU-X19 시수 차이가 열려 있으면 검토(인정)를 거절한다. 사유만으로는 닫히지 않는다.
create temp table f1 as select id from public.makeup_fulfillments;
create function pg_temp.verify(p_actor uuid, p_recs jsonb, p_code text, p_name text) returns void language sql as $$
  select mt.cmd_throws(p_actor, 'verify', jsonb_build_object('fulfillment_id', (select id from f1), 'recognitions', p_recs), mt.rev('makeup_fulfillments', (select id from f1)), p_code, p_name) $$;
select pg_temp.verify(mt.id(22), jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 55)), 'conflict', 'MU-X19 시수 차이가 열려 있는 동안 검토 거절');
select mt.cmd_throws(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch')), 'note', '합성'),
  (select revision from pg_temp.recon('units_mismatch')), 'forbidden', '시수 대사는 승인 권한자만 처리');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch')), 'note', '확인했음'),
  (select revision from pg_temp.recon('units_mismatch')), 'conflict', 'MU-X19 사유만으로는 시수 대사를 닫을 수 없다');
select mt.eq((select state from pg_temp.recon('units_mismatch')), 'open', '거절 뒤에도 대사는 열려 있다');
-- 출석부에서 시수를 정정(기존 행 UPDATE)하면 관측이 다시 판정해 대사가 닫히고 작업이 done이 된다.
update public.attendance_records set session_units = 1 where id = mt.id(91);
select mt.eq((select state || ':' || (detail ->> 'auto_resolved') from pg_temp.recon('units_mismatch')) || ':' || pg_temp.job((select id from p1)), 'resolved:true:done', 'MU-X19 출결 정정(UPDATE) 관측 → 대사 닫힘 + 반영 done');
-- MU-076 자기 검토 금지: 실제 강사가 관리자 권한이어도 본인 기록은 못 검토.
update public.users set system_role = 'admin' where id = mt.id(25);
select pg_temp.verify(mt.id(25), '[]'::jsonb, 'forbidden', 'MU-076 실제 강사의 자기 검토 거절');
update public.users set system_role = 'teacher' where id = mt.id(25);
-- MU-079 케이스별 인정 배분: 각 케이스가 자기 몫만 줄고, 배정 밖 케이스·총량 초과는 거절.
select pg_temp.verify(mt.id(22), jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 30)), 'invalid', 'MU-079 이 참여에 배정되지 않은 케이스 인정 거절');
select pg_temp.verify(mt.id(22), jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 60), jsonb_build_object('case_id', (select a2 from k), 'minutes', 55)), 'invalid', 'MU-079 인정 합이 실제 분량 초과 → 거절');
select pg_temp.verify(mt.id(22), jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 56)), 'conflict', 'MU-079 배정량 초과 인정 거절');
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f1), 'recognitions',
  jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 55), jsonb_build_object('case_id', (select a2 from k), 'minutes', 40))), mt.rev('makeup_fulfillments', (select id from f1)));
select mt.eq((select string_agg(outstanding_minutes::text || '/' || committed_minutes::text, ',' order by original_date desc) from public.makeup_cases where student_id = mt.id(61)), '5/0,20/0', 'MU-079 케이스별로 자기 몫만 소진(5·20 남음), 잔여 배정 해제');
select mt.eq((select expected_makeup_units from public.makeup_participants where id = (select id from p1)), 1.0, 'MU-X19 검토가 서버 계산 예상 보강분을 참여에 남긴다');

-- MU-X16·X17 관측 실패 작업이 닿는 케이스(a1)는 남은 분량을 면제해도 닫히지 않는다. 다시 관측해야 풀린다.
select mt.cmd(mt.id(22), 'waive', jsonb_build_object('case_id', (select a1 from k), 'minutes', 5, 'reason', '합성'), mt.rev('makeup_cases', (select a1 from k)));
select mt.eq((select lifecycle from public.makeup_cases where id = (select a1 from k)), 'open', 'MU-X16 관측 실패가 남아 있으면 종결되지 않는다');
select mt.cmd_throws(mt.id(22), 'close', jsonb_build_object('case_id', (select a1 from k), 'closure_reason', 'completed_with_waiver', 'reason', '합성'), mt.rev('makeup_cases', (select a1 from k)), 'conflict', 'MU-X17 미결 항목이 있으면 수동 종결도 거절');
create temp table jf as select id, revision from public.makeup_projection_jobs where effect_key = 'att-observe-failed:' || mt.id(90);
select mt.eq(mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from jf), 'status', 'done', 'reason', '합성 재관측'), (select revision from jf)) ->> 'projection_state',
  'done', '관측 실패 작업 다시 확인 = 그 출결 칸을 다시 관측(사유로 닫는 것이 아니다)');
select mt.eq((select state || ':' || blocks_close from pg_temp.recon('source_conflict')), 'open:true', 'MU-010 다시 관측하니 원수업 날 출석이 드러났다(source_conflict · 종결 차단)');
select mt.eq((select lifecycle from public.makeup_cases where id = (select a1 from k)), 'open', '원수업 충돌이 열려 있어 여전히 닫히지 않는다');
select mt.cmd_throws(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('source_conflict')), 'note', '합성'),
  (select revision from pg_temp.recon('source_conflict')), 'forbidden', '원수업 충돌을 그대로 두고 닫는 것은 승인 권한자만');
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('source_conflict')), 'note', '부분 출석 확인 — 결석 인정 유지'),
  (select revision from pg_temp.recon('source_conflict')));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select a1 from k)), 'closed:completed_with_waiver', '막던 항목이 풀리자 조건이 찬 케이스가 닫힌다');
select mt.eq((select lifecycle from public.makeup_cases where id = (select a2 from k)), 'open', '같은 참여의 다른 케이스는 잔량이 있어 열려 있다');

-- MU-X17 보강분이 미리 얹힌 칸인데 안 왔다 → 시수 확인 대사, 시수는 자동으로 깎지 않는다.
select mt.backdate((select session_id from public.makeup_participants where id = (select id from p1)), mt.d(-1));
create temp table p2 as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['1','2'], 110) as id;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(92), mt.id(11), mt.id(51), mt.id(62), mt.d(0), 'present', 2, mt.id(25));
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p2), 'status', 'no_show'));
select mt.eq((select kind || ':' || blocks_close || ':' || attendance_record_id::text || ':' || (detail ->> 'code') from pg_temp.recon('units_review')),
  'units_review:true:' || mt.id(92) || ':no_show_with_attendance', 'MU-X17 시수 확인 필요 대사 생성');
select mt.eq((select session_units from public.attendance_records where id = mt.id(92)), 2.0, 'MU-X17 시수 자동 삭감 없음');
select mt.cmd_throws(mt.id(22), 'close', jsonb_build_object('case_id', (select b1 from k), 'closure_reason', 'source_retracted', 'reason', '합성'), mt.rev('makeup_cases', (select b1 from k)), 'conflict', 'MU-X17 미결 시수 대사가 있는 동안 종결 차단');
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, supersedes_id)
  values (mt.id(94), mt.id(11), mt.id(51), mt.id(62), mt.d(0), 'late', 2, mt.id(25), mt.id(92));
select mt.eq((select state || ':' || attendance_record_id::text from pg_temp.recon('units_review')), 'open:' || mt.id(94), 'MU-X17 정정된 최신 출결 행으로 같은 대사가 갱신된다');

-- 참여를 먼저 기록하고 출결이 나중에 찍히는 순서: 출결 저장은 성공, 연결은 대기(pending) → 다시 확인하면 연결 + done.
create temp table kc as select mt.approved_case(mt.id(63), mt.id(51), mt.d(-6), 120) as c1, mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1;
create temp table p3 as select mt.reserved(mt.id(22), mt.id(63), (select c1 from kc), mt.d(0), array['3','4'], 110) as id;
select mt.eq(mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p3), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성')) ->> 'projection_state',
  'pending', '출결이 아직 없으면 반영은 pending(완료로 말하지 않는다)');
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(93), mt.id(11), mt.id(51), mt.id(63), mt.d(0), 'makeup', 1, mt.id(25));
select mt.eq(pg_temp.job((select id from p3)), 'pending', '참여 뒤에 찍힌 출결 → 사실은 맞지만 연결 대기(pending)');
select mt.eq(mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from public.makeup_projection_jobs where effect_key = 'att:' || (select id from p3)), 'reason', '합성 재반영'),
  (select revision from public.makeup_projection_jobs where effect_key = 'att:' || (select id from p3))) ->> 'projection_state', 'done', '다시 확인 → 검증을 지나 done');
select mt.eq((select attendance_record_id from public.makeup_participants where id = (select id from p3)), mt.id(93), '다시 확인이 관측된 출결 행을 연결한다');
-- 귀속 강사가 다르면(다른 강사 반의 칸 · taught_by 없음) 실패 + 대사. 출석부에서 담당을 고치면(UPDATE) 닫힌다.
create temp table p4 as select mt.reserved(mt.id(22), mt.id(64), (select d1 from kc), mt.d(0), array['5','6'], 110) as id;
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p4), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성'));
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(97), mt.id(11), mt.id(52), mt.id(64), mt.d(0), 'present', 1, mt.id(26));
select mt.eq(pg_temp.job((select id from p4)) || ':' || (select detail ->> 'code' from pg_temp.recon('attendance_observed')), 'failed:attendance_other_teacher', 'MU-033 귀속 강사가 보강 강사와 다르면 실패 + 대사');
create temp table f4 as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p4))) ->> 'id')::uuid as id;
select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f4), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select d1 from kc), 'minutes', 110))),
  mt.rev('makeup_fulfillments', (select id from f4)), 'conflict', 'MU-033 귀속이 어긋난 동안 검토 거절');
update public.attendance_records set taught_by = mt.id(25) where id = mt.id(97);
select mt.eq((select state from pg_temp.recon('attendance_observed')) || ':' || pg_temp.job((select id from p4)), 'resolved:pending', 'MU-033 담당 강사(taught_by) 정정(UPDATE) 관측 → 대사 닫힘 · 연결은 대기');
-- 인정 0분으로 검토하면 그 건은 인정 없이 배정만 풀린다(의무는 그대로). 검토가 출결 행을 연결한다.
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f4), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select d1 from kc), 'minutes', 0)), 'release_remainder', true),
  mt.rev('makeup_fulfillments', (select id from f4)));
select mt.eq((select outstanding_minutes || '/' || committed_minutes || '/' || recognized_minutes from public.makeup_cases where id = (select d1 from kc)), '120/0/0', '0분 인정 = 인정 없음 + 배정 해제(의무 유지)');
select mt.eq((select attendance_record_id from public.makeup_participants where id = (select id from p4)) || ':' || pg_temp.job((select id from p4)), mt.id(97) || ':done', '검토가 검증을 지나 출결 행을 연결하고 done');
-- 연결된 출결 행이 지워지면(삭제는 막지 않는다) 근거 삭제 대사가 남는다.
delete from public.attendance_records where id = mt.id(91);
select mt.eq((select count(*)::int from public.attendance_records where id = mt.id(91)), 0, '출결 삭제 자체는 막지 않는다');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'evidence_removed' and blocks_close), 1, '근거 삭제 대사 생성');
select count(*) as passed from mt.passed;
rollback;
