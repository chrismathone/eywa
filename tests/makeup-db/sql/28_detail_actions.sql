-- 보강 상세의 참여별 할 수 있는 일(0350a·0350b) — 회차마다 다른 답 · 힌트와 명령의 판정 일치 · 추가 지도 예약 · 출결 연결 표시 · 옛 칸 보존
begin;
select mt.seed_on();
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 300) as a1;
create function pg_temp.detail(p_actor uuid, p_case uuid) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_case_detail(%L::uuid)', p_case)) $$;
create function pg_temp.part(p_actor uuid, p_part uuid) returns jsonb language sql as $$
  select x from jsonb_array_elements(pg_temp.detail(p_actor, (select a1 from k)) -> 'participants') x where (x ->> 'id')::uuid = p_part $$;
-- 한 일의 답을 "true" 또는 "false:<까닭>"으로.
create function pg_temp.act(p_actor uuid, p_part uuid, p_action text) returns text language sql as $$
  select (x -> 'actions' ->> p_action) || coalesce(':' || (x -> 'blocked' ->> p_action), '') from pg_temp.part(p_actor, p_part) x $$;

-- 한 건에 회차 넷: 검토를 마친 지난 회차 · 오늘(미기록) · 아직 오지 않은 회차 · 다른 강사가 맡은 지난 회차(미기록).
create temp table pv as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(4), array['1','2'], 60) as id;
select mt.backdate((select session_id from public.makeup_participants where id = (select id from pv)), mt.d(-1));
select mt.fulfill((select id from pv), 60, jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 60)));
create temp table pt as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 60) as id;
create temp table pf as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), array['1','2'], 60) as id;
create temp table po as select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(5),
  'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(26), 'classroom_id', mt.id(42),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 30)))) ->> 'id')::uuid as id;
select mt.backdate((select session_id from public.makeup_participants where id = (select id from po)), mt.d(-2));

-- ① 회차를 맡은 강사(강사가)가 보는 답: 건 전체가 아니라 회차마다 다르다.
select mt.eq((pg_temp.detail(mt.id(25), (select a1 from k)) -> 'permissions' ->> 'participation')::boolean, true, '건 전체 힌트는 true 하나뿐이다(전에 모든 회차에 폼이 뜨던 까닭)');
select mt.eq(pg_temp.act(mt.id(25), (select id from pt), 'record'), 'true', '오늘 미기록 회차 — 기록할 수 있다');
select mt.eq(pg_temp.act(mt.id(25), (select id from pf), 'record'), 'false:future_session', '아직 오지 않은 회차 — 기록 불가');
select mt.eq(pg_temp.act(mt.id(25), (select id from pv), 'record'), 'false:verified', '검토를 마친 회차 — 기록 불가');
select mt.eq(pg_temp.act(mt.id(25), (select id from po), 'record'), 'false:not_conductor', '다른 강사가 맡은 회차 — 기록 불가');
select mt.eq(pg_temp.act(mt.id(25), (select id from pt), 'submit'), 'false:no_open_record', '참여 기록 전에는 제출할 기록이 없다');
select mt.eq(pg_temp.act(mt.id(25), (select id from pv), 'submit'), 'false:verified', '검토를 마친 기록은 다시 제출하지 않는다');
select mt.eq(pg_temp.act(mt.id(25), (select id from pt), 'cancel') || ' ' || pg_temp.act(mt.id(25), (select id from pt), 'reschedule'), 'true true', '미기록 회차 — 취소·변경 가능');
select mt.eq(pg_temp.act(mt.id(25), (select id from pv), 'cancel') || ' ' || pg_temp.act(mt.id(25), (select id from pv), 'reschedule'), 'false:session_closed false:session_closed', '끝난 회차 — 취소·변경 불가');
select mt.eq(pg_temp.act(mt.id(25), (select id from po), 'reschedule'), 'false:not_conductor', '담임이어도 남이 맡은 회차의 일정은 못 바꾼다');
select mt.eq(pg_temp.act(mt.id(25), (select id from po), 'cancel'), 'true', '담당 범위의 건이면 취소는 할 수 있다');

-- ② 힌트와 명령의 판정이 같다(같은 계정·같은 참여로 실제 명령을 보낸다).
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pf), 'status', 'present', 'actual_minutes', 60,
  'learning_summary', '합성'), null, 'conflict', '명령도 오지 않은 회차의 기록을 거절한다');
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pv), 'status', 'partial', 'actual_minutes', 30,
  'learning_summary', '합성'), null, 'conflict', '명령도 검토를 마친 회차의 기록을 거절한다');
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from po), 'status', 'partial', 'actual_minutes', 30,
  'learning_summary', '합성'), null, 'forbidden', '명령도 남이 맡은 회차의 기록을 거절한다');
select mt.cmd_throws(mt.id(25), 'reschedule', jsonb_build_object('session_id', (select session_id from public.makeup_participants where id = (select id from po)),
  'participant_id', (select id from po), 'session_date', mt.d(6), 'period_ids', '["1","2"]'::jsonb, 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
  'reason', '합성'), mt.rev('makeup_sessions', (select session_id from public.makeup_participants where id = (select id from po))), 'forbidden', '명령도 남이 맡은 회차의 변경을 거절한다');
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pt), 'status', 'partial', 'actual_minutes', 50,
  'learning_summary', '합성 지도 내용'));
select mt.eq(pg_temp.act(mt.id(25), (select id from pt), 'submit'), 'true', '참여를 기록하면 제출할 수 있다');
select mt.eq(pg_temp.act(mt.id(25), (select id from pt), 'cancel'), 'false:session_closed', '기록한 회차는 취소 대신 참여 기록을 정정한다');

-- ③ 계정에 따라: 지점 전체 운영은 강사가 달라도 기록할 수 있고, 회차를 맡은 강사나(26)는 자기 회차만.
select mt.eq(pg_temp.act(mt.id(22), (select id from po), 'record') || ' ' || pg_temp.act(mt.id(22), (select id from po), 'reschedule'), 'true true', '관리자는 남이 맡은 회차도 기록·변경');
select mt.eq(pg_temp.act(mt.id(26), (select id from po), 'record'), 'true', '회차를 맡은 강사는 자기 회차를 기록할 수 있다');
select mt.eq(pg_temp.act(mt.id(26), (select id from pf), 'record'), 'false:future_session', '같은 계정이라도 오지 않은 남의 회차는 날짜가 먼저 막는다');
select mt.eq(pg_temp.act(mt.id(26), (select id from pf), 'reschedule'), 'false:not_conductor', '맡지 않은 회차의 일정은 못 바꾼다');

-- ④ 더한 칸: 오늘 날짜 · 출결 반 이름 · 출결 연결 · 실시 근거 종류. 지도 근거 글만으로 인정한 참여는 출결 연결이 없다(표시일 뿐).
select mt.eq((pg_temp.detail(mt.id(22), (select a1 from k)) ->> 'today'), mt.d(0)::text, '서버의 오늘');
select mt.eq((pg_temp.part(mt.id(22), (select id from pv)) ->> 'anchor_class_name'), '수학 가반', '출결 반 이름');
select mt.eq((pg_temp.part(mt.id(22), (select id from pv)) ->> 'attendance_link'), 'none', '지도 근거 글로 인정한 참여 — 출결 연결 없음');
select mt.eq((select x ->> 'evidence_kind' from jsonb_array_elements(pg_temp.detail(mt.id(22), (select a1 from k)) -> 'fulfillments') x
  where (x ->> 'participant_id')::uuid = (select id from pv)), 'manual', '실시 근거 종류');
select mt.eq((select state from public.makeup_fulfillments where participant_id = (select id from pv)), 'verified', '출결 연결이 없어도 인정은 그대로 유효하다');
select mt.eq((select count(*)::int from public.makeup_projection_jobs where participant_id = (select id from pv))
  + (select count(*)::int from public.makeup_reconciliation where participant_id = (select id from pv) and blocks_close), 0,
  '출결 연결이 없다고 반영 작업·종결 차단 항목이 생기지 않는다(표시일 뿐)');
-- 종결 조건은 그대로다: 출결이 한 줄도 없어도 지도 근거로 전량 인정하면 자동 종결되고, 상세는 "출결 연결 없음"으로 보여 준다.
create temp table c2 as select mt.approved_case(mt.id(63), mt.id(51), mt.d(-6), 60) as id;
create temp table pc as select mt.reserved(mt.id(22), mt.id(63), (select id from c2), mt.d(4), array['3','4'], 60) as id;
select mt.backdate((select session_id from public.makeup_participants where id = (select id from pc)), mt.d(-3));
select mt.fulfill((select id from pc), 60, jsonb_build_array(jsonb_build_object('case_id', (select id from c2), 'minutes', 60)));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select id from c2)), 'closed:completed', '출결 0줄 · 지도 근거 전량 인정 → 자동 종결(종전 그대로)');
select mt.eq((select count(*)::int from public.attendance_records), 0, '출결은 한 줄도 없다');
select mt.eq((select x ->> 'attendance_link' from jsonb_array_elements(pg_temp.detail(mt.id(22), (select id from c2)) -> 'participants') x), 'none', '닫힌 건의 상세도 출결 연결 없음으로 보여 준다');
-- 출결이 관측돼 확인 대기 작업이 생기면 pending, 연결되면 linked.
select mt.as_command();
insert into public.makeup_projection_jobs (tenant_id, kind, effect_key, participant_id, participant_ids, state)
  values (mt.id(11), 'effect_gap', 'gap:audit:' || (select id from pt)::text, (select id from pt), array[(select id from pt)], 'failed');
select mt.end_command();
select mt.eq((pg_temp.part(mt.id(22), (select id from pt)) ->> 'attendance_link'), 'none', '다른 종류의 실패 작업은 출결 연결 상태를 바꾸지 않는다');
select mt.as_command();
insert into public.makeup_projection_jobs (tenant_id, kind, effect_key, participant_id, participant_ids, state)
  values (mt.id(11), 'attendance_effect', 'att:' || (select id from pt)::text, (select id from pt), array[(select id from pt)], 'pending');
select mt.end_command();
select mt.eq((pg_temp.part(mt.id(22), (select id from pt)) ->> 'attendance_link'), 'pending', '확인 대기 작업이 있으면 pending');
select mt.as_command();
update public.makeup_projection_jobs set state = 'failed' where participant_id = (select id from pt);
select mt.end_command();
select mt.eq((pg_temp.part(mt.id(22), (select id from pt)) ->> 'attendance_link'), 'failed', '반영 실패 작업이 있으면 failed');

-- ⑤ 옛 화면이 읽는 칸은 전부 그대로 있다(칸만 더했다).
select mt.ok((pg_temp.detail(mt.id(22), (select a1 from k)) ?& array['mode', 'case', 'policy', 'quantities', 'sources', 'sessions', 'participants',
  'allocations', 'fulfillments', 'recognitions', 'adjustments', 'events', 'events_total', 'reconciliation', 'projection_jobs', 'legacy_maps', 'permissions']),
  '상세의 옛 칸 17개 그대로');
select mt.ok((pg_temp.part(mt.id(22), (select id from pt)) ?& array['id', 'revision', 'session_id', 'student_id', 'session_date', 'status', 'planned_minutes',
  'actual_minutes', 'anchor_class_id', 'attendance_record_id', 'expected_makeup_units', 'cancel_reason', 'recorded_by', 'recorded_at']), '참여의 옛 칸 그대로');
select mt.ok((select bool_and(x ?& array['id', 'revision', 'case_id', 'participant_id', 'allocated_minutes', 'recognized_minutes', 'released_minutes',
  'live_minutes', 'release_reason', 'original_date']) from jsonb_array_elements(pg_temp.detail(mt.id(22), (select a1 from k)) -> 'allocations') x), '배정의 옛 칸 그대로');

-- ⑥ 추가 지도: 승인돼 잔량이 있어도 예약 힌트는 false(예약 확정은 항상 거절된다). 결석 건의 예약 힌트는 그대로 true.
create temp table ad as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'reason', 'additional', 'subject_key', 'math')) ->> 'id')::uuid as id;
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from ad), 'target_minutes', 60), mt.rev('makeup_cases', (select id from ad)));
select mt.eq((pg_temp.detail(mt.id(22), (select id from ad)) -> 'permissions' ->> 'reserve')::boolean, false, '추가 지도 건은 예약 힌트 false');
select mt.eq((pg_temp.detail(mt.id(22), (select id from ad)) -> 'case' ->> 'reservable_minutes')::int, 60, '잔량은 그대로 보인다(접수·승인은 된다)');
select mt.cmd_throws(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(62), 'session_date', mt.d(6), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select id from ad), 'minutes', 30))),
  null, 'conflict', '명령도 추가 지도 예약을 거절한다(힌트와 같다)');
select mt.eq((pg_temp.detail(mt.id(22), (select a1 from k)) -> 'permissions' ->> 'reserve')::boolean, true, '결석 건의 예약 힌트는 그대로 true');

-- ⑦ 정리 중: 새 일정으로 옮기는 것만 막힌다(취소·기록은 된다).
select mt.cmd(mt.id(21), 'configure', '{"mode":"draining"}');
select mt.eq(pg_temp.act(mt.id(22), (select id from pf), 'reschedule'), 'false:draining', '정리 중에는 일정 변경 불가');
select mt.eq(pg_temp.act(mt.id(22), (select id from pf), 'cancel'), 'true', '정리 중에도 취소는 된다');
select mt.eq((pg_temp.detail(mt.id(22), (select a1 from k)) -> 'permissions' ->> 'reserve')::boolean, false, '정리 중에는 예약 힌트 false(종전과 같다)');
select count(*) as passed from mt.passed;
rollback;
