-- 접수·원사건·정책 (MU-002·003·006·007·008·009·010·011·012·049·071·076·081 · MU-X04 · MU-065/X06은 확정 거절 회귀)
begin;
select mt.seed_on();

-- MU-002 같은 날 서로 다른 원수업 두 건은 날짜만으로 합치지 않는다(같은 반·같은 날은 한 건).
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(61), mt.id(52), mt.d(-200));
create temp table c1 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51), 'original_date', mt.d(-5))) ->> 'id')::uuid as id;
create temp table c2 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(52), 'original_date', mt.d(-5))) ->> 'id')::uuid as id;
select mt.ok((select id from c1) <> (select id from c2), 'MU-002 같은 날 다른 원수업은 별개 건');
select mt.eq((select count(*)::int from public.makeup_cases), 2, 'MU-002 케이스 2건');
-- MU-006·027 영어는 첫 출시 대상이 아니다 · MU-081 분 단위만 · MU-X04 과목 없는 건 거절.
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(53), 'original_date', mt.d(-5)), null, 'invalid', 'MU-006·027 영어 접수 거절(대상 과목 아님)');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-5), 'unit_kind', 'sessions'), null, 'invalid', 'MU-081 분 단위가 아닌 접수 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'reason', 'additional'), null, 'invalid', 'MU-X04 과목 없는 추가 지도 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-5), 'subject_key', 'english'), null, 'invalid', 'MU-X04 원반과 다른 과목 주입 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-5), 'occurrence_key', 'day:forged'), null, 'invalid', '원사건 키 위조 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(64), 'original_class_id', mt.id(51), 'original_date', mt.d(-5)), null, 'invalid', '그 반 수강생이 아닌 학생 접수 거절');

-- 출결 행 근거: 결석이면 스냅샷과 함께 연결, 출석이면 거절. 같은 원수업 재접수는 근거만 추가.
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(81), mt.id(11), mt.id(51), mt.id(61), mt.d(-5), 'absent', null, mt.id(25)),
         (mt.id(82), mt.id(11), mt.id(51), mt.id(62), mt.d(-5), 'present', 1, mt.id(25));
select mt.eq((mt.cmd(mt.id(25), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51), 'original_date', mt.d(-5),
  'source_kind', 'attendance', 'source_id', mt.id(81))) ->> 'id')::uuid, (select id from c1), 'MU-001 출결 근거 재접수는 같은 건');
select mt.eq((select count(*)::int from public.makeup_case_sources where case_id = (select id from c1)), 2, '근거 2개(수동 + 출결)가 한 건에 붙는다');
select mt.eq((select snapshot ->> 'status' from public.makeup_case_sources where source_kind = 'attendance'), 'absent', '출결 스냅샷 보존');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-5),
  'source_kind', 'attendance', 'source_id', mt.id(82)), null, 'invalid', '출석으로 찍힌 날은 결석 접수 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-5),
  'source_kind', 'attendance', 'source_id', mt.id(81)), null, 'invalid', 'MU-038 다른 학생의 출결 행 결합 거절');

-- MU-010 원결석이 출석으로 정정 → source_conflict 대사만 생긴다(건은 지워지지 않고 그대로 열려 있다).
insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, supersedes_id)
  values (mt.id(11), mt.id(51), mt.id(61), mt.d(-5), 'present', 1, mt.id(25), mt.id(81));
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'source_conflict' and case_id = (select id from c1) and state = 'open'), 1, 'MU-010 source_conflict 대사 생성');
select mt.eq((select lifecycle from public.makeup_cases where id = (select id from c1)), 'open', 'MU-010 자동 삭제·소멸 없음');
select mt.eq((select count(*)::int from public.attendance_records where session_date = mt.d(-5) and student_id = mt.id(61)), 2, '출결 정정 저장은 그대로 성공');

-- MU-011 예정 결석(미래 원수업) · MU-049 1년 넘은 결석도 접수·조회된다.
create temp table c3 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(8), 'reason', 'planned_absence')) ->> 'id')::uuid as id;
select mt.ok((select absence_planned from public.makeup_cases where id = (select id from c3)), 'MU-011 예정 결석 표시');
insert into public.enrollments (tenant_id, student_id, class_id, start_date, end_date) values (mt.id(11), mt.id(63), mt.id(52), mt.d(-900), mt.d(-300));
create temp table c4 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(63), 'original_class_id', mt.id(52), 'original_date', mt.d(-400))) ->> 'id')::uuid as id;
select mt.ok(exists (select 1 from jsonb_array_elements(mt.run(mt.id(22), 'select public.makeup_list_cases()') -> 'rows') r where (r ->> 'id')::uuid = (select id from c4)), 'MU-049 400일 전 건도 기본 목록에 남는다');

-- MU-009 정책 스냅샷: 먼저 승인한 건은 옛 버전을 그대로 본다.
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c1), 'target_minutes', 120), mt.rev('makeup_cases', (select id from c1)));
create temp table pol1 as select policy_version_id as id from public.makeup_cases where id = (select id from c1);
select mt.cmd(mt.id(21), 'configure', '{"policy":{"label":"새 정책"}}'::jsonb);
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c2), 'target_minutes', 120), mt.rev('makeup_cases', (select id from c2)));
select mt.eq((select policy_version_id from public.makeup_cases where id = (select id from c1)), (select id from pol1), 'MU-009 기존 건은 옛 정책 버전 유지');
select mt.ok((select policy_version_id from public.makeup_cases where id = (select id from c2)) <> (select id from pol1), 'MU-009 새 승인은 새 버전');
select mt.throws('update public.makeup_policy_versions set self_verify = true', '42501', '정책 버전은 고칠 수 없다(불변)');

-- MU-012·071 기한: 기한 뒤 날짜 예약은 승인 권한자만(예외), 강사 범위는 원수업 다음 달 말일까지.
select mt.cmd(mt.id(22), 'adjust', jsonb_build_object('case_id', (select id from c1), 'due_date', mt.d(1), 'reason', '합성 기한'), mt.rev('makeup_cases', (select id from c1)));
select mt.cmd_throws(mt.id(24), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(3), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from c1), 'minutes', 60))),
  null, 'conflict', 'MU-012 기한 지난 날짜는 운영 권한만으로 예약 불가');
select mt.ok(exists (select 1 from jsonb_array_elements(mt.run(mt.id(24), 'select public.makeup_list_cases()') -> 'rows') r where (r ->> 'id')::uuid = (select id from c1)), 'MU-071 기한이 있어도 목록에는 보인다');
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c4), 'target_minutes', 60, 'owner_id', mt.id(26)), mt.rev('makeup_cases', (select id from c4)));
select mt.cmd_throws(mt.id(26), 'reserve', jsonb_build_object('student_id', mt.id(63), 'session_date', mt.d(3), 'period_ids', '["1"]'::jsonb,
  'teacher_id', mt.id(26), 'classroom_id', mt.id(42), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from c4), 'minutes', 55))),
  null, 'conflict', 'MU-012 강사는 다음 달 말일이 지난 결석을 예약할 수 없다');
select mt.ok((mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(63), 'session_date', mt.d(3), 'period_ids', '["1"]'::jsonb,
  'teacher_id', mt.id(26), 'classroom_id', mt.id(42), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from c4), 'minutes', 55)))) ->> 'id') is not null,
  'MU-012 관리자는 오래된 건도 예약할 수 있다(자동 소멸 없음)');

-- 추가 지도(원결석 없음): 접수·승인까지만 된다. 예약 확정은 첫 운영 범위 밖이라 언제나 거절된다.
create temp table c5 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'reason', 'additional', 'subject_key', 'math')) ->> 'id')::uuid as id;
select mt.ok((select original_date is null and original_class_id is null and occurrence_key like 'manual:%' from public.makeup_cases where id = (select id from c5)), 'MU-065 추가 지도는 가짜 결석일 없이 접수');
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c5), 'target_minutes', 60), mt.rev('makeup_cases', (select id from c5)));
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(62), 'session_date', mt.d(3), 'period_ids', '["3"]'::jsonb, 'teacher_id', mt.id(25),
  'classroom_id', mt.id(41), 'anchor_class_id', mt.id(51), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from c5), 'minutes', 55))),
  null, 'conflict', 'MU-065·X06 추가 지도 예약 확정 거절(허용 꺼짐)');
-- 첫 운영 범위는 서버가 강제한다: 추가 지도 허용·수납 기준 확정·자기 검토·수학 밖 과목은 설정 요청 자체를 거절한다.
select mt.cmd_throws(mt.id(21), 'configure', '{"allow_additional":true}'::jsonb, null, 'invalid', 'MU-X06 추가 지도 허용 설정 거절');
select mt.cmd_throws(mt.id(21), 'configure', '{"policy":{"label":"추가 지도 기준","additional_billing":"no_charge"}}'::jsonb, null, 'invalid', 'MU-X06 추가 지도 수납 기준 확정 거절(예약을 여는 길이 없다)');
select mt.cmd_throws(mt.id(21), 'configure', '{"policy":{"label":"자기 검토","self_verify":true}}'::jsonb, null, 'invalid', 'MU-076 자기 검토 허용 정책 거절');
select mt.cmd_throws(mt.id(21), 'configure', '{"pilot_subjects":["math","english"]}'::jsonb, null, 'invalid', 'MU-006 대상 과목에 영어를 섞으면 거절');
select mt.cmd_throws(mt.id(21), 'configure', '{"pilot_subjects":["english"]}'::jsonb, null, 'invalid', 'MU-006 영어만 대상으로 바꾸는 것도 거절');
select mt.cmd_throws(mt.id(21), 'configure', '{"pilot_subjects":[]}'::jsonb, null, 'invalid', '빈 대상 과목 거절');
select mt.ok((mt.cmd(mt.id(21), 'configure', '{"pilot_subjects":["math"]}'::jsonb) -> 'settings' -> 'pilotSubjects') = '["math"]'::jsonb, '수학 하나는 그대로 저장된다');
select mt.eq((select data -> 'makeups' from public.tenant_settings where tenant_id = mt.id(11)),
  '{"mode":"on","allowAdditional":false,"pilotSubjects":["math"]}'::jsonb, '저장된 설정은 첫 운영 범위 그대로');
-- 명령을 거치지 않은 쓰기(검증 전용 표식)도 표의 제약이 막는다.
select mt.as_command();
select mt.throws($$insert into public.makeup_policy_versions (tenant_id, label, effective_from, self_verify) values (mt.id(11), '직접', mt.d(0), true)$$, '23514', '자기 검토 정책은 표 제약으로도 못 넣는다');
select mt.throws($$insert into public.makeup_policy_versions (tenant_id, label, effective_from, additional_billing) values (mt.id(11), '직접', mt.d(0), 'no_charge')$$, '23514', '추가 지도 수납 기준도 표 제약으로 못 넣는다');
select mt.end_command();
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(62), 'session_date', mt.d(3), 'period_ids', '["3"]'::jsonb, 'teacher_id', mt.id(25),
  'classroom_id', mt.id(41), 'anchor_class_id', mt.id(51), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from c5), 'minutes', 55))),
  null, 'conflict', 'MU-065·X06 설정을 어떻게 보내도 추가 지도 예약은 열리지 않는다');
select mt.eq((select count(*)::int from public.makeup_participants where student_id = mt.id(62)), 0, 'MU-065 추가 지도 참여·예약 행이 생기지 않았다');
select mt.eq((select count(*)::int from public.makeup_reservations where student_id = mt.id(62)), 0, 'MU-065 출결 화면용 예약 행(가짜 결석일)도 없다');

-- MU-007·008 원반 종강·학생 수강 종료·반 삭제 시도에도 건은 남는다(연쇄 삭제 없음).
update public.classes set closed_at = mt.d(-1), is_active = false where id = mt.id(51);
update public.enrollments set end_date = mt.d(-1) where class_id = mt.id(51);
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases()') ->> 'total')::int, 5, 'MU-008 종강·수강 종료 뒤에도 미처리 건 5건 그대로');
select mt.throws('delete from public.makeup_reservations where true; delete from public.class_schedules where class_id = mt.id(51); delete from public.enrollments where class_id = mt.id(51); delete from public.attendance_records where class_id = mt.id(51); delete from public.classes where id = mt.id(51)', '23503', 'MU-007 원반 삭제는 원장이 막는다');
select mt.throws('delete from public.makeup_cases', '42501', '케이스 직접 삭제 거절');
select count(*) as passed from mt.passed;
rollback;
