-- 출결 반 확인(anchor_missing) 복구: 반 후보(purpose=anchor) · 잘못된 반 거절 · 맞는 반 저장 + 관측(연결하지 않는다) · 대사 항목의 anchor_context (0350c·e·f)
begin;
select mt.seed_on();
-- 학생D·E는 수학 나반(52). 둘 다 원반을 떠났고(종료), 학생D만 수학 가반(51)으로 옮겼다. 학생D는 영어 가반(53)도 다닌다.
create temp table k as select
  mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1,
  mt.approved_case(mt.id(65), mt.id(52), mt.d(-5), 120) as e1;
update public.enrollments set end_date = mt.d(-1) where student_id in (mt.id(64), mt.id(65)) and class_id = mt.id(52);
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values
  (mt.id(11), mt.id(64), mt.id(51), mt.d(-1)), (mt.id(11), mt.id(64), mt.id(53), mt.d(-200));
create function pg_temp.opt(p_actor uuid, p_filter jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_options(%L::jsonb)', p_filter)) $$;
create function pg_temp.names(p jsonb) returns text language sql as $$
  select coalesce(string_agg(r ->> 'name', ',' order by r ->> 'name'), '') from jsonb_array_elements(p -> 'rows') r $$;
create function pg_temp.recon(p_actor uuid, p_case uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(mt.run(p_actor, format('select public.makeup_case_detail(%L::uuid)', p_case)) -> 'reconciliation') x
   where x ->> 'kind' = 'anchor_missing' $$;
create function pg_temp.rsv(p_student uuid, p_case uuid, p_date date) returns uuid language sql as $$
  select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', p_student, 'session_date', p_date, 'period_ids', '["1","2"]'::jsonb,
    'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'allocations', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', 50)))) ->> 'id')::uuid $$;

-- 원반이 그날 유효하지 않으면 출결 반을 비워 두고 확인 항목을 연다(종전 그대로).
create temp table pd as select pg_temp.rsv(mt.id(64), (select d1 from k), mt.d(0)) as id;
select mt.ok((select anchor_class_id is null from public.makeup_participants where id = (select id from pd)), '유효한 원반이 없으면 출결 반을 비워 둔다');
create temp table rd as select id from public.makeup_reconciliation where kind = 'anchor_missing' and participant_id = (select id from pd);

-- ① 대사 항목이 반 후보를 찾을 재료를 싣는다(참여의 지금 값 — 과목 포함). 상세와 대사 목록이 같은 값을 준다.
select mt.eq(pg_temp.recon(mt.id(22), (select d1 from k)) -> 'anchor_context',
  jsonb_build_object('student_id', mt.id(64), 'subject_key', 'math', 'session_date', mt.d(0)), '출결 반 확인 항목의 anchor_context');
select mt.eq((select x -> 'anchor_context' ->> 'subject_key' from jsonb_array_elements(
  mt.run(mt.id(22), 'select public.makeup_list_reconciliation(''{}''::jsonb)') -> 'rows') x where (x ->> 'id')::uuid = (select id from rd)), 'math', '대사 목록도 같은 값');
select mt.as_command();
insert into public.makeup_reconciliation (tenant_id, kind, dedupe_key, case_id, participant_id)
  values (mt.id(11), 'owner_inactive', 'synthetic:other-kind', (select d1 from k), (select id from pd));
select mt.end_command();
select mt.eq((select count(*)::int from jsonb_array_elements(mt.run(mt.id(22), 'select public.makeup_list_reconciliation(''{}''::jsonb)') -> 'rows') x
  where x ->> 'kind' = 'owner_inactive' and x -> 'anchor_context' = 'null'::jsonb), 1, '다른 종류의 항목에는 싣지 않는다(같은 참여여도)');

-- ② 반 후보: 그날 그 학생이 다니는 같은 과목의 운영 중인 반만(떠난 원반·다른 과목 반은 빠진다).
select mt.eq(pg_temp.names(pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'purpose', 'anchor', 'subject_key', 'math',
  'student_id', mt.id(64), 'session_date', mt.d(0)))), '수학 가반', '후보는 옮겨 간 수학 가반 하나');
select mt.eq(pg_temp.names(pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'purpose', 'anchor', 'subject_key', 'math',
  'student_id', mt.id(64), 'session_date', mt.d(-3)))), '수학 나반', '날짜를 따른다 — 사흘 전에는 아직 수학 나반');
select mt.eq((pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'purpose', 'anchor', 'subject_key', 'math',
  'student_id', mt.id(65), 'session_date', mt.d(0))) ->> 'total')::int, 0, '어느 반에도 다니지 않으면 후보 0건(화면이 다음 조치를 안내한다)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22),
  format('select public.makeup_options(%L::jsonb)', jsonb_build_object('kind', 'classes', 'purpose', 'anchor', 'student_id', mt.id(64)))),
  'invalid', '날짜 없이 purpose를 주면 거절(조건 없이 전체를 내주지 않는다)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22),
  format('select public.makeup_options(%L::jsonb)', jsonb_build_object('kind', 'classes', 'purpose', 'anywhere', 'student_id', mt.id(64), 'session_date', mt.d(0)))),
  'invalid', '모르는 purpose는 거절');
-- 과목을 안 주면 다른 과목 반도 섞인다 — 그래서 anchor_context가 과목을 싣는다. 섞인 반을 골라도 명령이 거절한다.
select mt.eq(pg_temp.names(pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'purpose', 'anchor',
  'student_id', mt.id(64), 'session_date', mt.d(0)))), '수학 가반,영어 가반', '과목 없이 물으면 영어 반도 나온다');

-- ③ 복구: 반을 안 고르면 · 그날 다니지 않는 반이면 · 과목이 다르면 거절. 맞는 반이면 저장하고 그 반의 출결을 관측한다.
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rd), 'reason', '합성'),
  mt.rev('makeup_reconciliation', (select id from rd)), 'invalid', '반을 고르지 않으면 닫지 못한다(전에 화면이 보내던 요청)');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rd), 'reason', '합성',
  'anchor_class_id', mt.id(52)), mt.rev('makeup_reconciliation', (select id from rd)), 'invalid', '그날 다니지 않는 반은 거절');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rd), 'reason', '합성',
  'anchor_class_id', mt.id(53)), mt.rev('makeup_reconciliation', (select id from rd)), 'invalid', '과목이 다른 반은 거절');
select mt.cmd_throws(mt.id(25), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rd), 'reason', '합성',
  'anchor_class_id', mt.id(51)), mt.rev('makeup_reconciliation', (select id from rd)), 'forbidden', '강사 범위 계정은 출결 반을 정하지 못한다(종전 그대로)');
select mt.ok((select anchor_class_id is null from public.makeup_participants where id = (select id from pd)), '거절된 요청은 아무것도 바꾸지 않았다');
create temp table ok1 as select mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rd),
  'reason', '수학 가반으로 옮김 확인', 'anchor_class_id', mt.id(51)), mt.rev('makeup_reconciliation', (select id from rd))) as r;
select mt.eq((select anchor_class_id from public.makeup_participants where id = (select id from pd)), mt.id(51), '고른 반이 출결 반으로 저장된다');
select mt.eq((select state from public.makeup_reconciliation where id = (select id from rd)), 'resolved', '확인 항목이 닫힌다');
select mt.eq((select r ->> 'anchor_class_id' from ok1), mt.id(51)::text, '결과에 출결 반');
select mt.eq((select r -> 'anchor_verification' from ok1), '{"state": "pending", "ok": false, "code": "attendance_missing"}'::jsonb,
  '그 반에 그날 출결이 없으면 확인 대기(정상)');
select mt.ok((select not (r ? 'projection_state') from ok1), '결과에 projection_state 칸은 없다(화면의 반영 대기 경고를 켜지 않는다)');
select mt.eq((select count(*)::int from public.makeup_projection_jobs) || ':' ||
  (select count(*)::int from public.makeup_reconciliation where state = 'open' and participant_id = (select id from pd)
     and kind in ('units_mismatch', 'units_review', 'attendance_observed')), '0:0',
  '출결이 없으면 반영 작업도 시수·출결 확인 항목도 만들지 않는다');
select mt.eq((select count(*)::int from public.makeup_events where event_type = 'reconciliation_resolved' and entity_id = (select id from rd)), 1, '처리 이벤트 1건');
select mt.eq((select count(*)::int from public.attendance_records), 0, '복구는 출결을 쓰지 않는다');

-- ④ 그 반에 그날 출결이 이미 있으면: 관측 작업이 남는다(참여 기록 전이라 대기). 참여에 출결을 잇지는 않는다.
create temp table pe as select pg_temp.rsv(mt.id(65), (select e1 from k), mt.d(0)) as id;
create temp table re as select id from public.makeup_reconciliation where kind = 'anchor_missing' and participant_id = (select id from pe);
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(65), mt.id(51), mt.d(-1));
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(91), mt.id(11), mt.id(51), mt.id(65), mt.d(0), 'makeup', 0.5, mt.id(25));
select mt.eq((select count(*)::int from public.makeup_projection_jobs where participant_id = (select id from pe)), 0, '출결 반이 비어 있는 동안에는 출결을 찍어도 관측되지 않는다');
create temp table ok2 as select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from re),
  'reason', '합성', 'anchor_class_id', mt.id(51)), mt.rev('makeup_reconciliation', (select id from re))) as r;
select mt.eq((select r -> 'anchor_verification' ->> 'state' from ok2), 'pending', '출결은 있고 참여 기록 전 — 확인 대기');
select mt.eq((select state || ':' || (payload ->> 'attendance_record_id') from public.makeup_projection_jobs where participant_id = (select id from pe)),
  'pending:' || mt.id(91)::text, '반을 정하는 순간 그 반의 출결이 관측된다(대기 작업 1건)');
select mt.ok((select attendance_record_id is null from public.makeup_participants where id = (select id from pe)), '관측만 한다 — 참여에 출결을 잇지 않는다');
select mt.eq((select count(*)::int from public.attendance_records where id = mt.id(91) and session_units = 0.5), 1, '출결 행·시수는 그대로');

-- ⑤ 취소된 참여의 항목: 반은 정해지지만 관측하지 않는다(취소된 참여에 확인 항목을 새로 열지 않는다).
create temp table pc as select pg_temp.rsv(mt.id(64), (select d1 from k), mt.d(3)) as id;
create temp table rc as select id from public.makeup_reconciliation where kind = 'anchor_missing' and participant_id = (select id from pc);
select mt.cmd(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from pc), 'reason', '합성 취소'), mt.rev('makeup_participants', (select id from pc)));
create temp table ok3 as select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from rc),
  'reason', '합성', 'anchor_class_id', mt.id(51)), mt.rev('makeup_reconciliation', (select id from rc))) as r;
select mt.ok((select r -> 'anchor_verification' = 'null'::jsonb from ok3), '취소된 참여는 관측하지 않는다');
select mt.eq((select count(*)::int from public.makeup_reconciliation where participant_id = (select id from pc) and state = 'open'), 0, '취소된 참여에 새 항목이 열리지 않는다');

-- ⑥ 범위: 건은 보이지만(업무 담당) 그 참여는 범위 밖인 강사에게는 anchor_context가 가지 않는다(참여 번호와 같은 규칙).
create temp table c3 as select mt.approved_case(mt.id(63), mt.id(51), mt.d(-6), 120) as id;
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select id from c3), 'owner_id', mt.id(26), 'reason', '합성 담당 지정'), mt.rev('makeup_cases', (select id from c3)));
update public.enrollments set end_date = mt.d(-1) where student_id = mt.id(63) and class_id = mt.id(51);
create temp table p3 as select pg_temp.rsv(mt.id(63), (select id from c3), mt.d(4)) as id;
select mt.eq(pg_temp.recon(mt.id(22), (select id from c3)) -> 'anchor_context' ->> 'student_id', mt.id(63)::text, '지점 전체 운영은 재료를 받는다');
select mt.ok((pg_temp.recon(mt.id(26), (select id from c3)) ->> 'kind') = 'anchor_missing', '업무 담당 강사에게 항목 자체는 보인다');
select mt.ok((select x -> 'anchor_context' = 'null'::jsonb and x -> 'participant_id' = 'null'::jsonb from pg_temp.recon(mt.id(26), (select id from c3)) x),
  '범위 밖 참여의 학생·날짜·번호는 내보내지 않는다');
select count(*) as passed from mt.passed;
rollback;
