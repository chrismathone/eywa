-- 수량·취소·변경·노쇼·부분 검토·반전·면제·종결 (MU-013·014·020·021·028·031·051·068·078·079·080 · MU-X07·X08·X09·X10)
begin;
select mt.seed_on();
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 120) as a1,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-6), 120) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-6), 240) as c1;
create function pg_temp.q(p_case uuid) returns text language sql as $$
  select format('O=%s C=%s R=%s', outstanding_minutes, committed_minutes, outstanding_minutes - committed_minutes)
    from public.makeup_cases where id = p_case $$;

-- MU-013 취소 후 재예약: 같은 케이스, 잔량 유지, 이전 시도 보존.
create temp table p1 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), array['1','2'], 110) as id;
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=110 R=10', '예약 뒤 수량');
select mt.cmd_throws(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from p1), 'reason', '합성 취소'), null, 'stale_revision', 'MU-051 개정 번호 없이 취소 거절');
select mt.cmd(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from p1), 'reason', '합성 취소', 'cause', 'student'), mt.rev('makeup_participants', (select id from p1)));
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=0 R=120', 'MU-013 취소 뒤 의무 유지·점유 해제');
select mt.eq((select status || ':' || (select state from public.makeup_sessions s where s.id = p.session_id) from public.makeup_participants p where id = (select id from p1)), 'cancelled:cancelled', 'MU-013 시도는 취소 상태로 남는다');
select mt.eq((select count(*)::int from public.makeup_reservations), 0, 'MU-075 취소는 출결 화면용 예약 행만 지운다');
select mt.eq((select state from public.makeup_legacy_maps), 'released', '연결 행은 스냅샷과 함께 남는다');
create temp table p2 as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(3), array['1','2'], 110) as id;
select mt.eq((select count(*)::int from public.makeup_participants where student_id = mt.id(61)), 2, 'MU-013 재예약은 새 참여(이전 시도 보존)');

-- MU-014 세 번 시간 변경: 회차 사슬·개정 번호·이력. MU-051 옛 개정 번호는 거절.
create temp table s0 as select session_id as id, (select revision from public.makeup_sessions where id = session_id) as rev from public.makeup_participants where id = (select id from p2);
create function pg_temp.move(p_date date) returns uuid language sql as $$
  select (mt.cmd(mt.id(22), 'reschedule', jsonb_build_object('session_id', s.id, 'session_date', p_date, 'period_ids', '["1","2"]'::jsonb,
    'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'reason', '합성 변경'), s.revision) ->> 'id')::uuid
  from public.makeup_sessions s where s.state = 'confirmed' and exists (select 1 from public.makeup_participants p where p.session_id = s.id and p.student_id = mt.id(61) and p.status = 'unknown') $$;
select pg_temp.move(mt.d(4));
select mt.cmd_throws(mt.id(22), 'reschedule', jsonb_build_object('session_id', (select id from s0), 'session_date', mt.d(5), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'reason', '옛 화면'), (select rev from s0), 'stale_revision', 'MU-051 옛 개정 번호로 변경 거절(덮어쓰기 없음)');
select pg_temp.move(mt.d(5));
select pg_temp.move(mt.d(0));
select mt.eq((select count(*)::int from public.makeup_sessions where state = 'rescheduled' and replaced_by_session_id is not null), 3, 'MU-014 옛 회차 3건이 새 회차로 이어진다');
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=110 R=10', 'MU-014 변경은 점유를 옮길 뿐 늘리지 않는다');
select mt.eq((select count(*)::int from public.makeup_reservations where makeup_date = mt.d(0)), 1, '출결 화면용 예약 행도 새 날짜 1건');

-- MU-X08 120 예약 중 60 인정: 검토가 잔여 배정을 자동 해제 → 별도 해제 없이 재예약.
create temp table p3 as select id from public.makeup_participants where student_id = mt.id(61) and status = 'unknown';
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p3), 'status', 'partial', 'actual_minutes', 60, 'learning_summary', '합성 지도 내용'));
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=110 R=10', 'MU-028 일부 참여만으로는 소진 0');
create temp table f3 as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p3), 'learning_summary', '합성')) ->> 'id')::uuid as id;
select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 61))),
  mt.rev('makeup_fulfillments', (select id from f3)), 'invalid', 'MU-028 실제 지도 분량보다 많이 인정 거절');
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f3), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 60))), mt.rev('makeup_fulfillments', (select id from f3)));
select mt.eq(pg_temp.q((select a1 from k)), 'O=60 C=0 R=60', 'MU-X08 60 인정 뒤 O=60·C=0·R=60');
select mt.eq((select released_minutes || ':' || release_reason from public.makeup_allocations where participant_id = (select id from p3)), '50:partial_verify', 'MU-X08 잔여 50분 자동 해제');

-- 승인된 건의 기한: 운영 권한만으로는 못 바꾸고(조용히 무시하지 않는다), 승인 권한자가 바꾸면 결정 기록이 남는다.
select mt.cmd_throws(mt.id(24), 'assign', jsonb_build_object('case_id', (select b1 from k), 'due_date', mt.d(20), 'reason', '합성'), mt.rev('makeup_cases', (select b1 from k)), 'forbidden', '승인된 건의 기한 변경은 승인 권한자만');
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select b1 from k), 'owner_id', mt.id(25), 'due_date', mt.d(20), 'reason', '합성 기한'), mt.rev('makeup_cases', (select b1 from k)));
select mt.eq((select due_date from public.makeup_cases where id = (select b1 from k)), mt.d(20), '승인 권한자의 기한 지정');
select mt.eq((select count(*)::int from public.makeup_adjustments where case_id = (select b1 from k) and kind = 'due_date'), 1, '기한 변경은 결정 기록으로 남는다');
-- MU-031·X09 반전: 원배분 한 번 복원, 옛 좌석·점유는 되살리지 않는다, 원기록 보존.
select mt.cmd(mt.id(22), 'reverse', jsonb_build_object('fulfillment_id', (select id from f3), 'reason', '합성 정정'), mt.rev('makeup_fulfillments', (select id from f3)));
select mt.eq(pg_temp.q((select a1 from k)), 'O=120 C=0 R=120', 'MU-X09 반전 뒤 의무 복원·점유 0');
select mt.eq((select count(*) filter (where kind = 'recognize') || ':' || count(*) filter (where kind = 'reverse') from public.makeup_recognitions), '1:1', 'MU-031 원기록 보존 + 반전 1건');
select mt.cmd_throws(mt.id(22), 'reverse', jsonb_build_object('fulfillment_id', (select id from f3), 'reason', '두 번째'), mt.rev('makeup_fulfillments', (select id from f3)), 'conflict', 'MU-031 반전은 한 번만');
select mt.throws('select mt.as_command(); insert into public.makeup_recognitions (tenant_id, fulfillment_id, allocation_id, case_id, participant_id, kind, minutes, effect_key, reversal_of) select tenant_id, fulfillment_id, allocation_id, case_id, participant_id, ''reverse'', minutes, ''x'', id from public.makeup_recognitions where kind = ''recognize''', '23505', 'MU-031 같은 인정의 두 번째 반전은 유니크가 막는다');
select mt.end_command();
select mt.eq((select count(*)::int from public.attendance_records), 0, 'MU-X09 반전은 출결·시수를 건드리지 않는다');

-- 반전 뒤 정정: 같은 참여를 새 버전으로 다시 제출·검토한다(풀려 있던 같은 배정을 예약 가능량 안에서 되잡는다).
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p3), 'status', 'partial', 'actual_minutes', 60, 'learning_summary', '합성 지도 내용'));
create temp table f4 as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p3), 'learning_summary', '합성 정정')) ->> 'id')::uuid as id;
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f4), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 40))), mt.rev('makeup_fulfillments', (select id from f4)));
select mt.eq((select version || ':' || state from public.makeup_fulfillments where id = (select id from f4)), '2:verified', 'MU-031 정정은 새 버전(옛 기록은 reversed로 보존)');
select mt.eq(pg_temp.q((select a1 from k)), 'O=80 C=0 R=80', 'MU-031 정정한 인정량만 다시 반영');
-- MU-020·X07 합반 한 명 노쇼: 그 학생 배정만 풀리고 의무는 남는다. 다른 학생 기록은 그대로.
select mt.backdate((select session_id from public.makeup_participants where id = (select id from p3)), mt.d(-1));
create temp table pb as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['1','2'], 110) as id;
create temp table pc as select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('session_id', (select session_id from public.makeup_participants where id = (select id from pb)),
  'student_id', mt.id(63), 'allocations', jsonb_build_array(jsonb_build_object('case_id', (select c1 from k), 'minutes', 110)))) ->> 'id')::uuid as id;
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'no_show'));
select mt.eq(pg_temp.q((select b1 from k)), 'O=120 C=0 R=120', 'MU-X07 노쇼: 의무 120·점유 0·예약 가능 120');
select mt.eq(pg_temp.q((select c1 from k)), 'O=240 C=110 R=130', 'MU-020 다른 학생의 배정은 그대로');
select mt.eq((select state from public.makeup_sessions where id = (select session_id from public.makeup_participants where id = (select id from pb))), 'confirmed', 'MU-020 한 명 노쇼로 회차가 끝나지 않는다');
select mt.eq((select count(*)::int from public.makeup_events where event_type = 'allocation_released' and data ->> 'release_reason' = 'no_show'), 1, 'MU-X07 해제 사유 감사 기록');
-- 잘못 누른 노쇼는 되돌릴 수 있다(배정을 되잡는다).
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성 지도 내용'));
select mt.eq(pg_temp.q((select b1 from k)), 'O=120 C=110 R=10', '노쇼 오클릭 정정 → 배정 되잡기');
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'no_show'));
-- MU-021 일부 학생 취소: 이미 기록한 학생은 취소가 아니라 정정 대상.
select mt.cmd_throws(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from pb), 'reason', '합성'), mt.rev('makeup_participants', (select id from pb)), 'conflict', '참여를 기록한 일정은 취소 대신 정정');
select mt.cmd(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from pc), 'reason', '합성 학생 사정'), mt.rev('makeup_participants', (select id from pc)));
select mt.eq(pg_temp.q((select c1 from k)), 'O=240 C=0 R=240', 'MU-021 한 학생 취소는 그 학생 배정만 해제');
select mt.eq((select state || ':' || coalesce(finish_reason, '-') from public.makeup_sessions where id = (select session_id from public.makeup_participants where id = (select id from pb))), 'confirmed:-', 'MU-021 다른 학생이 남은 회차는 취소되지 않는다');

-- MU-080·X10 면제: 살아 있는 약속이 있으면 거절 → 취소 뒤 부분 면제(open 유지) → 나머지 실시 뒤 completed_with_waiver.
create temp table pw as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(4), array['1','2'], 110) as id;
select mt.cmd_throws(mt.id(22), 'waive', jsonb_build_object('case_id', (select c1 from k), 'minutes', 120, 'reason', '합성'), mt.rev('makeup_cases', (select c1 from k)), 'live_commitments', 'MU-X10 살아 있는 약속이 있으면 면제 거절');
select mt.cmd_throws(mt.id(22), 'close', jsonb_build_object('case_id', (select c1 from k), 'closure_reason', 'source_retracted', 'reason', '합성'), mt.rev('makeup_cases', (select c1 from k)), 'live_commitments', 'MU-X10 살아 있는 약속이 있으면 종결 거절');
select mt.cmd(mt.id(22), 'cancel', jsonb_build_object('participant_id', (select id from pw), 'reason', '면제 전 취소'), mt.rev('makeup_participants', (select id from pw)));
select mt.cmd_throws(mt.id(22), 'waive', jsonb_build_object('case_id', (select c1 from k), 'minutes', 241, 'reason', '합성'), mt.rev('makeup_cases', (select c1 from k)), 'invalid', 'MU-078 남은 분량보다 많은 면제 거절');
select mt.cmd(mt.id(22), 'waive', jsonb_build_object('case_id', (select c1 from k), 'minutes', 130, 'reason', '합성 부분 면제'), mt.rev('makeup_cases', (select c1 from k)));
select mt.eq(pg_temp.q((select c1 from k)) || ' ' || (select lifecycle from public.makeup_cases where id = (select c1 from k)), 'O=110 C=0 R=110 open', 'MU-080 부분 면제는 open 유지');
select mt.cmd_throws(mt.id(22), 'adjust', jsonb_build_object('case_id', (select c1 from k), 'minutes', -110, 'reason', '합성'), mt.rev('makeup_cases', (select c1 from k)), 'invalid', 'MU-078 조정으로 0 만들기 거절(면제는 한 곳에서만)');
select mt.cmd_throws(mt.id(22), 'close', jsonb_build_object('case_id', (select c1 from k), 'closure_reason', 'completed', 'reason', '합성'), mt.rev('makeup_cases', (select c1 from k)), 'conflict', '남은 분량이 있으면 완료 종결 거절');
select mt.backdate((select session_id from public.makeup_participants where id = (select id from pb)), mt.d(-2));
create temp table pz as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(0), array['1','2'], 110) as id;
select mt.fulfill((select id from pz), 110, jsonb_build_array(jsonb_build_object('case_id', (select c1 from k), 'minutes', 110)));
select mt.eq((select lifecycle || ':' || closure_reason || ':' || recognized_minutes || ':' || waived_minutes from public.makeup_cases where id = (select c1 from k)),
  'closed:completed_with_waiver:110:130', 'MU-080 실시 + 면제 혼합 종결(실시·면제량 따로 기록)');
-- MU-078 음수·초과는 DB 제약이 마지막으로 막는다.
select mt.throws('select mt.as_command(); update public.makeup_cases set recognized_minutes = 999 where id = (select a1 from k)', '23514', 'MU-078 초과 인정은 CHECK가 거절(0으로 숨기지 않는다)');
select mt.end_command();
-- 보류 중에는 새 일정을 잡지 못한다.
select mt.cmd(mt.id(24), 'hold', jsonb_build_object('case_id', (select a1 from k), 'reason', '합성 휴원', 'hold_review_at', mt.d(30)), mt.rev('makeup_cases', (select a1 from k)));
select mt.throws(format('select mt.reserved(%L::uuid, %L::uuid, %L::uuid, %L::date, array[''1''], 50)', mt.id(22), mt.id(61), (select a1 from k), mt.d(6)), 'conflict', '보류 중 예약 거절(잔량은 보존)');
select mt.cmd(mt.id(24), 'resume', jsonb_build_object('case_id', (select a1 from k)), mt.rev('makeup_cases', (select a1 from k)));
select mt.eq((select lifecycle from public.makeup_cases where id = (select a1 from k)), 'open', '재개');
select count(*) as passed from mt.passed;
rollback;
