-- 반영 실패 기록(앱 → 원장) · 증거 조회 (보완 1·2·8 — MU-026·034·036·052 · MU-X16)
-- 출결 저장 훅이 "출결은 저장했지만 원장에는 반영하지 못했다"를 남기는 문. 이 문은 출결·시수·보고서를 쓰지 않는다.
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1;
create temp table pa as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
create temp table resv as select m.legacy_id as id from public.makeup_legacy_maps m where m.participant_id = (select id from pa) and m.state = 'active';
create function pg_temp.gap(p_actor uuid, p jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_note_effect_gap(%L::jsonb)', p)) $$;
create function pg_temp.gap_throws(p_actor uuid, p jsonb, p_code text, p_name text) returns void language sql as $$
  select mt.throws(format('select mt.run(%L::uuid, %L)', p_actor, format('select public.makeup_note_effect_gap(%L::jsonb)', p)), p_code, p_name) $$;
create function pg_temp.mine() returns jsonb language sql as $$
  select jsonb_build_object('effect_key', 'att:' || (select id from pa), 'kind', 'teacher_hold', 'participant_id', (select id from pa),
    'reservation_id', (select id from resv), 'error', '정규 수업 강사가 달라 정규 시수를 쓰지 않았습니다') $$;
create function pg_temp.blockers() returns integer language sql as $$ select (makeup_private.close_blockers(mt.id(11), (select a1 from k)) ->> 'projections')::int $$;

-- ① 담당 강사가 남긴 표시 = 실패(failed) 작업 한 줄. 닿는 참여·케이스를 적어 그 케이스의 종결을 막는다.
create temp table g1 as select pg_temp.gap(mt.id(25), pg_temp.mine()) as r;
select mt.eq((select (r ->> 'queued') || ':' || (r ->> 'state') || ':' || (r ->> 'kind') || ':' || (r -> 'case_ids' ->> 0) from g1), 'true:failed:teacher_hold:' || (select a1 from k), 'MU-X16 표시가 원장에 남는다(queued · failed · 닿는 케이스)');
select mt.eq((select kind || ':' || effect_key || ':' || (participant_ids = array[(select id from pa)]) || ':' || (case_ids = array[(select a1 from k)]) || ':' || last_error
  from public.makeup_projection_jobs where id = (select (r ->> 'id')::uuid from g1)),
  'effect_gap:gap:teacher_hold:att:' || (select id from pa) || ':true:true:정규 수업 강사가 달라 정규 시수를 쓰지 않았습니다', '작업 줄에 종류·효과 키·참여·케이스·사유를 적는다');
select mt.eq(pg_temp.blockers(), 1, 'MU-X16 표시가 남아 있는 동안 그 케이스는 종결되지 않는다');
select mt.eq((select count(*)::int from public.makeup_events where event_type = 'effect_gap_noted' and actor_id = mt.id(25)), 1, '누가 남겼는지 이벤트로 남는다');
-- ② (효과 키, 종류)에 멱등: 다시 보내도 한 줄 · 시도 수도 늘지 않는다. 종류가 다르면 다른 줄.
create temp table g2 as select pg_temp.gap(mt.id(25), pg_temp.mine()) as r;
select mt.eq((select (r ->> 'id') from g2), (select (r ->> 'id') from g1), '같은 표시 재전송 → 같은 줄');
select mt.eq((select count(*)::int || ':' || max(attempts) from public.makeup_projection_jobs where kind = 'effect_gap') || ':' ||
  (select count(*) from public.makeup_events where event_type = 'effect_gap_noted'), '1:0:1', '줄·시도 수·이벤트가 늘지 않는다');
select pg_temp.gap(mt.id(25), pg_temp.mine() || '{"kind":"observation","error":"출결은 그대로 두고 참여 반영을 대기열에 남겼습니다"}');
select mt.eq((select count(*)::int from public.makeup_projection_jobs where kind = 'effect_gap'), 2, '종류가 다르면 별도 줄');
-- ③ 거절: 행위자 없음 · 관리자 클라이언트 · 범위 밖 · 형식 · 대상 없음 · 꺼진 지점.
select pg_temp.gap_throws(null, pg_temp.mine(), 'forbidden', '로그인 없는 호출 거절(행위자를 인자로 넘기는 길이 없다)');
create temp table payload as select pg_temp.mine() as p;
grant select on payload to service_role;
set local role service_role;
select mt.throws(format('select public.makeup_note_effect_gap(%L::jsonb)', (select p from payload)), '42501', '관리자 클라이언트는 실행 권한이 없다');
reset role;
select pg_temp.gap_throws(mt.id(26), pg_temp.mine(), 'not_found', 'MU-036 범위 밖 강사의 표시 거절(있는지도 알려 주지 않는다)');
select pg_temp.gap_throws(mt.id(28), pg_temp.mine(), 'forbidden', '권한 없는 계정 거절');
select pg_temp.gap_throws(mt.id(25), pg_temp.mine() || '{"kind":"Teacher Hold!"}', 'invalid', '종류 형식 검증');
select pg_temp.gap_throws(mt.id(25), jsonb_build_object('effect_key', 'x', 'kind', 'observation'), 'invalid', '참여도 예약도 가리키지 않는 표시는 받지 않는다');
select pg_temp.gap_throws(mt.id(31), pg_temp.mine(), 'mode_off', '꺼진 지점에서는 예외(빈 성공이 아니다)');
select mt.eq((select count(*)::int from public.attendance_records) + (select count(*)::int from public.lesson_reports), 0, 'MU-034 표시는 출결·보고서를 만들지 않는다');

-- ④ 서버가 직접 다시 판정한다. 사유만으로 닫히지 않고, 출결과 참여가 검증을 지나면 표시가 스스로 닫힌다.
create temp table jg as select id, revision from public.makeup_projection_jobs where effect_key = 'gap:teacher_hold:att:' || (select id from pa);
select mt.eq(mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from jg), 'status', 'done', 'reason', '완료 처리'), (select revision from jg)) ->> 'projection_state',
  'pending', 'MU-052·X16 참여 기록 전에는 "완료"를 보내도 pending(요청이 완료를 정하지 못한다)');
select mt.eq(pg_temp.blockers() >= 1, true, '여전히 종결을 막는다');
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(301), mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'makeup', 1, mt.id(25));
select mt.eq((select string_agg(state, ',' order by effect_key) from public.makeup_projection_jobs where kind = 'effect_gap'), 'failed,pending', 'MU-026 출결만 찍혀서는 닫히지 않는다(참여 기록 전 — 다시 확인한 줄은 pending, 나머지는 failed 그대로)');
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pa), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(301)));
select mt.eq((select string_agg(state, ',' order by effect_key) from public.makeup_projection_jobs where kind = 'effect_gap'), 'done,done', '참여 기록이 검증을 지나면 그 참여의 표시가 함께 닫힌다');
select mt.eq(pg_temp.blockers(), 0, '막던 표시가 풀렸다');
-- ⑤ 증거 조회(읽기 전용): 출결 행·시수·귀속 강사·보고서·실제 강사. 완료 여부는 state가 말한다.
create temp table ev as select mt.run(mt.id(25), format('select public.makeup_projection_evidence(%L)', 'att:' || (select id from pa))) as r;
select mt.eq((select (r ->> 'state') || ':' || (r -> 'evidence' ->> 'attendance_record_id') || ':' || (r -> 'evidence' ->> 'session_units') || ':' || (r -> 'evidence' ->> 'actual_teacher_id') from ev),
  'done:' || mt.id(301) || ':1.0:' || mt.id(25), '증거: 출결 행·시수·실제 강사');
select mt.ok((select r -> 'evidence' ? 'taught_by' and r -> 'evidence' ? 'report_id' and (r -> 'verification' ->> 'ok')::boolean from ev), '증거에 귀속 강사·보고서 칸이 있고(비어 있어도 키는 있다) 검증 결과가 함께 온다');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(25), 'select public.makeup_projection_evidence(''hold:abc'')'), 'invalid', '참여의 효과 키가 아니면 거절');

-- ⑥ 원장에 연결되지 않은 기존 예약의 표시: 예약·그 칸의 지금 상태로 다시 확인한다.
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(102), mt.id(11), mt.id(63), mt.id(51), mt.d(-6), mt.d(0), '10:00', '11:00');
create temp table g3 as select pg_temp.gap(mt.id(25), jsonb_build_object('effect_key', 'classify:' || mt.id(102), 'kind', 'classify_blocked', 'reservation_id', mt.id(102), 'error', '보강 참여를 확인하지 못했습니다')) as r;
select mt.eq((select (r ->> 'state') || ':' || jsonb_array_length(r -> 'case_ids') from g3), 'failed:0', '연결 안 된 예약의 표시도 남는다(닿는 케이스 없음)');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_reconciliation()') ->> 'projection_failed')::int, 1, '지점 전체 권한의 대사 목록에 보인다');
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(303), mt.id(11), mt.id(51), mt.id(63), mt.d(0), 'makeup', 1, mt.id(25));
create temp table j3 as select (r ->> 'id')::uuid as id from g3;
select mt.eq(mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from j3), 'reason', '재확인'), mt.rev('makeup_projection_jobs', (select id from j3))) -> 'verification' ->> 'code',
  'legacy_pending', '예약이 아직 대기인데 그 칸에 출석이 있다 → 이행이 남았다(failed 유지)');
update public.makeup_reservations set status = 'done', done_at = now(), attendance_record_id = mt.id(303) where id = mt.id(102);
select mt.eq(mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from j3), 'reason', '재확인'), mt.rev('makeup_projection_jobs', (select id from j3))) ->> 'projection_state',
  'done', '예약이 이행된 뒤 다시 확인 → done');
select mt.eq((select count(*)::int from public.makeup_projection_jobs where state <> 'done'), 0, '미처리 작업 0건');
select count(*) as passed from mt.passed;
rollback;
