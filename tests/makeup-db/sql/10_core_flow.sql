-- 업무 한 바퀴: 접수 → 승인 → 예약 → 참여 → 제출 → 검토 → 자동 종결 (MU-001·003·005·025·030)
begin;
select mt.seed_on();

-- 접수: 권리 발급이 아니다(pending · 목표 null).
create temp table t as select mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61),
  'original_class_id', mt.id(51), 'original_date', mt.d(-6), 'reason', 'absence')) as r;
grant select on t to authenticated;
select mt.ok((select r ? 'id' and r ? 'revision' and r ? 'effect_key' and (r ->> 'replayed')::boolean = false from t), 'intake 결과에 id·revision·effect_key·replayed');
select mt.eq((select eligibility from public.makeup_cases), 'pending', 'MU-003 접수는 pending');
select mt.ok((select target_minutes is null and outstanding_minutes is null from public.makeup_cases), 'MU-003 목표·잔량 null');
select mt.eq((select occurrence_key from public.makeup_cases),
  'day:' || mt.id(61) || ':' || mt.id(51) || ':' || to_char(mt.d(-6), 'YYYY-MM-DD'), '원사건 키는 서버 도출');
-- 같은 결석을 다른 요청으로 다시 접수 → 같은 케이스.
select mt.eq((mt.cmd(mt.id(25), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51),
  'original_date', mt.d(-6))) ->> 'id')::uuid, (select (r ->> 'id')::uuid from t), 'MU-001 같은 원수업 재접수는 같은 케이스');
select mt.eq((select count(*)::int from public.makeup_cases), 1, 'MU-001 케이스 1건');
-- 승인 전 예약 거절.
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(0),
  'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 60))), null,
  'conflict', '승인 전 예약 확정 거절');
-- 승인(180분).
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select r ->> 'id' from t), 'target_minutes', 180),
  (select revision from public.makeup_cases));
select mt.eq((select outstanding_minutes from public.makeup_cases), 180, '승인 뒤 O=180');
select mt.ok((select policy_version_id is not null from public.makeup_cases), '정책 버전 고정');
select mt.eq((select count(*)::int from public.makeup_policy_versions where approved_by = mt.id(22)), 1, '기본 정책은 승인자 명의로 생성');

-- 예약 1: 오늘 1~2교시(110분) 중 110분 배정.
create temp table p1 as select mt.reserved(mt.id(22), mt.id(61), (select (r ->> 'id')::uuid from t), mt.d(0), array['1','2'], 110) as id;
select mt.eq((select committed_minutes from public.makeup_cases), 110, '예약은 점유만(C=110)');
select mt.eq((select outstanding_minutes from public.makeup_cases), 180, '예약은 의무를 줄이지 않는다(O=180)');
select mt.eq((select count(*)::int from public.makeup_reservations where status = 'reserved'), 1, '출결 화면용 예약 행 투영');
select mt.eq((select count(*)::int from public.makeup_legacy_maps where state = 'active'), 1, '예약 행 연결');
-- 남은 예약 가능량 초과 배정 거절(R=70).
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(3),
  'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 80))), null,
  'conflict', 'MU-068 미검증 점유 유지 — 초과 배정 거절');

-- 참여(왔다): 근거 없이는 기록되지 않는다 → 명시한 분 + 지도 근거로 기록하면 초안 실시 기록, 점유 유지.
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110), null, 'evidence_required', 'MU-029 근거 없는 참여 기록 거절');
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p1), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성 지도 내용'));
select mt.eq((select state from public.makeup_fulfillments), 'draft', '참여 → 실시 초안');
select mt.eq((select committed_minutes from public.makeup_cases), 110, 'MU-025 출결만으로 소진 0(점유 유지)');
select mt.eq((select state from public.makeup_sessions), 'finished', '전원 기록 → 회차 finished');
select mt.eq((select status from public.makeup_reservations), 'done', '연결된 예약 행만 이행');
-- 제출: 참여 때 남긴 근거를 그대로 올린다.
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p1)));
select mt.eq((select evidence_kind || ':' || learning_summary from public.makeup_fulfillments), 'manual:합성 지도 내용', 'MU-029 실시 기록에 근거 종류와 내용이 남는다');
select mt.eq((select state from public.makeup_fulfillments), 'submitted', '제출');
select mt.eq((select outstanding_minutes from public.makeup_cases), 180, '제출만으로 O 불변');
-- 검토: 강사는 못 한다 · 관리자가 110분 인정.
select mt.cmd_throws(mt.id(25), 'verify', jsonb_build_object('fulfillment_id', (select id from public.makeup_fulfillments),
  'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 110))),
  (select revision from public.makeup_fulfillments), 'forbidden', 'MU-039 강사 검토 거절');
create temp table v1 as select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from public.makeup_fulfillments),
  'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 110))),
  (select revision from public.makeup_fulfillments)) as r;
select mt.eq((select outstanding_minutes from public.makeup_cases), 70, 'MU-005 첫 검토 뒤 O=70');
select mt.eq((select committed_minutes from public.makeup_cases), 0, '검토 뒤 C=0');
select mt.eq((select lifecycle from public.makeup_cases), 'open', 'MU-005 잔량이 있으면 열려 있다');
-- 같은 실시를 다른 요청으로 다시 검토 → 한 번만.
select mt.cmd_throws(mt.id(23), 'verify', jsonb_build_object('fulfillment_id', (select id from public.makeup_fulfillments),
  'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 110))),
  (select revision from public.makeup_fulfillments), 'conflict', 'MU-030 이중 검토 거절');
select mt.eq((select count(*)::int from public.makeup_recognitions), 1, 'MU-030 인정 1건');

-- 예약 2: 다른 날 70분 → 참여·제출·검토 → 자동 종결(두 번째 검토 뒤에만 완료).
select mt.backdate((select session_id from public.makeup_participants where id = (select id from p1)), mt.d(-1));
create temp table p2 as select mt.reserved(mt.id(22), mt.id(61), (select (r ->> 'id')::uuid from t), mt.d(0), array['3','4'], 70) as id;
select mt.eq((select committed_minutes from public.makeup_cases), 70, '둘째 예약 C=70');
select mt.fulfill((select id from p2), 70, jsonb_build_array(jsonb_build_object('case_id', (select r ->> 'id' from t), 'minutes', 70)));
select mt.eq((select outstanding_minutes from public.makeup_cases), 0, 'MU-005 둘째 검토 뒤 O=0');
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases), 'closed:completed', 'MU-005 둘째 검토 뒤 자동 종결(completed)');
select mt.eq((select count(*)::int from public.makeup_events where event_type = 'closed'), 1, '종결 이벤트 1건');
-- 원결석 출결·시수는 건드리지 않는다(원장은 출결 행을 쓰지 않는다).
select mt.eq((select count(*)::int from public.attendance_records), 0, 'MU-034 원장은 출결 행을 만들지 않는다');
-- 같은 요청 번호 재시도 = 같은 결과(replayed), 다른 사람·다른 내용 = 충돌.
create temp table rep as select gen_random_uuid() as cid;
select mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), null, (select cid from rep));
select mt.eq((mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), null, (select cid from rep)) ->> 'replayed')::boolean, true, 'MU-001 같은 요청 재시도는 replayed');
select mt.throws(format('select mt.cmd(%L::uuid, %L, %L::jsonb, null, %L::uuid)', mt.id(23), 'intake',
  jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), (select cid from rep)),
  'command_conflict', 'MU-067 다른 사람이 같은 요청 번호 재사용 → 충돌');
select mt.throws(format('select mt.cmd(%L::uuid, %L, %L::jsonb, null, %L::uuid)', mt.id(22), 'intake',
  jsonb_build_object('student_id', mt.id(63), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), (select cid from rep)),
  'command_conflict', 'MU-067 같은 요청 번호에 다른 내용 → 충돌');
select mt.eq((select count(*)::int from public.makeup_cases), 2, '재시도·충돌로 케이스가 늘지 않는다');
select count(*) as passed from mt.passed;
rollback;
