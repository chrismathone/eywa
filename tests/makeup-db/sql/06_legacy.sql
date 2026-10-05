-- 기존 예약(0264a) 연결·보호·이관 규칙 (MU-055·056·072·073·074·075 · MU-X05·X14)
begin;
select mt.seed_on();
select mt.login(null);
-- 출석부에 이미 잡혀 있던 예약들(연결 전). r1: 학생A 예정 · r2: 학생B 이미 done · r3: 학생A 같은 날 다른 교시 · r4: 학생A 다른 날(형제 예약)
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, note, recorded_by)
  values (mt.id(81), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'absent', null, '합성 사유' || chr(10) || '보강 예정', mt.id(25));
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, status, created_by)
  values (mt.id(101), mt.id(11), mt.id(61), mt.id(51), mt.d(-6), mt.d(0), '10:00', '11:50', '1-1~1-2', 'reserved', mt.id(25)),
         (mt.id(102), mt.id(11), mt.id(62), mt.id(51), mt.d(-6), mt.d(-2), '10:00', '11:00', '1-1', 'done', mt.id(25)),
         (mt.id(103), mt.id(11), mt.id(61), mt.id(51), mt.d(-13), mt.d(0), '13:00', '14:00', '2-1', 'reserved', mt.id(25)),
         (mt.id(104), mt.id(11), mt.id(61), mt.id(51), mt.d(-20), mt.d(5), '10:00', '11:00', '1-1', 'reserved', mt.id(25));

-- MU-072 기존 약속 연결: 일정 그대로 보존, 새 권리 자동 발급 없음(pending · 목표 null · 점유만).
select mt.cmd_throws(mt.id(25), 'link_legacy', jsonb_build_object('source_id', mt.id(101)), null, 'forbidden', '강사 범위는 기존 예약 연결 불가');
create temp table l1 as select mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(101))) as r;
create temp table c1 as select (r ->> 'id')::uuid as id, (r ->> 'participant_id')::uuid as part from l1;
select mt.eq((select eligibility || ':' || coalesce(target_minutes::text, 'null') || ':' || committed_minutes || ':' || imported_commitment::text || ':' || reason
  from public.makeup_cases where id = (select id from c1)), 'pending:null:110:true:imported', 'MU-072 pending + 목표 없음 + 기존 약속 110분 점유');
select mt.eq((select to_char(start_time, 'HH24:MI') || '~' || to_char(end_time, 'HH24:MI') || ':' || imported::text from public.makeup_sessions), '10:00~11:50:true', 'MU-072 기존 일정 시각 그대로');
select mt.eq((select count(*)::int from public.makeup_reservations where id = mt.id(101)), 1, 'MU-072 예약 행은 그대로 남는다');
-- MU-055 같은 예약을 다시 연결해도 늘지 않는다.
select mt.eq((mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(101))) ->> 'existing')::boolean, true, 'MU-055 재실행은 no-op');
select mt.eq((select count(*)::int from public.makeup_cases) || ':' || (select count(*)::int from public.makeup_participants) || ':' || (select count(*)::int from public.makeup_allocations), '1:1:1', 'MU-055 재실행 뒤 원장·배정 증가 0');
-- 승인 전 약속 영향 검토: 약속보다 적은 승인·약속이 살아 있는 거절은 거절(숨기거나 자동 취소하지 않는다).
select mt.cmd_throws(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c1), 'target_minutes', 60), mt.rev('makeup_cases', (select id from c1)), 'live_commitments', 'MU-072 기존 약속보다 적은 승인 거절');
select mt.cmd_throws(mt.id(22), 'deny', jsonb_build_object('case_id', (select id from c1), 'reason', '합성'), mt.rev('makeup_cases', (select id from c1)), 'live_commitments', 'MU-072 약속이 살아 있으면 자격 거절만 저장하지 않는다');
select mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', (select id from c1), 'target_minutes', 120), mt.rev('makeup_cases', (select id from c1)));

-- MU-073 연결된 예약은 직접 수정·삭제가 막힌다. 연결 안 된 예약은 종전 그대로.
select mt.throws('delete from public.makeup_reservations where id = mt.id(101)', 'P0001', 'MU-073 연결된 예약 직접 삭제 거절');
select mt.throws('update public.makeup_reservations set status = ''done'' where id = mt.id(101)', 'P0001', 'MU-073 연결된 예약 직접 이행 처리 거절(명령으로 위임)');
update public.makeup_reservations set note = '연결 안 된 예약 수정' where id = mt.id(104);
select mt.eq((select note from public.makeup_reservations where id = mt.id(104)), '연결 안 된 예약 수정', 'MU-X14 연결 안 된 예약은 종전대로 수정');

-- MU-X01 같은 날 둘째 기존 예약은 강제로 합치지 않고 검토 큐로(예약 행은 보존, 연결하지 않는다).
select mt.eq((mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(103))) -> 'warnings' ->> 0), 'legacy_multi_same_day', '같은 날 둘째 기존 예약 → 검토 큐');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'legacy_multi_same_day' and legacy_id = mt.id(103)), 1, '복수 예약 검토 대사 생성');
select mt.eq((select count(*)::int from public.makeup_participants), 1, '둘째 예약은 참여로 합치지 않는다');
select mt.eq((select count(*)::int from public.makeup_reservations where id = mt.id(103)), 1, '둘째 예약 행 보존(삭제·병합 없음)');
-- 원장에 참여가 있는 날에 옛 경로로 예약을 새로 넣는 우회는 거절.
select mt.throws(format('insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end) values (%L, %L, %L, %L, %L, ''15:00'', ''16:00'')',
  mt.id(11), mt.id(61), mt.id(51), mt.d(-27), mt.d(0)), 'P0001', 'MU-X14 하루 한 건 상한을 옛 예약 경로로 넘지 못한다');

-- MU-056 done뿐인 기존 예약은 검토 완료로 올리지 않는다.
create temp table l2 as select mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(102))) as r;
select mt.eq((select status from public.makeup_participants where id = (select (r ->> 'participant_id')::uuid from l2)), 'unknown', 'MU-056 done 예약도 참여는 미기록');
select mt.eq((select count(*)::int from public.makeup_fulfillments), 0, 'MU-056 실시·검토 기록 자동 생성 없음');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'legacy_done_review' and legacy_id = mt.id(102)), 1, 'MU-056 사람 검토 대사 생성');

-- MU-074 연결 뒤 원본이 달라져 있으면 no-op이 아니라 재검토 충돌.
select mt.as_command();
update public.makeup_reservations set note = '원본이 바뀜' where id = mt.id(102);
select mt.end_command();
select mt.eq((mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(102))) -> 'warnings' ->> 0), 'legacy_checksum_conflict', 'MU-074 원본 변경 → 충돌 경고');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'legacy_checksum_conflict'), 1, 'MU-074 재검토 대사 생성');

-- MU-X05 형제 예약: 연결된 한 참여만 이행된다. 큐에 남은 다른 예약(r3·r4)은 자동 done·시수 추가 없음.
-- 기존 예약에서 온 회차는 실제 강사가 비어 있다 → 지정 없이는 기록 거절, 지정하면 그 강사가 실제 강사로 남는다.
select mt.cmd_throws(mt.id(27), 'participation', jsonb_build_object('participant_id', (select part from c1), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성 지도 내용'), null, 'invalid', '가져온 회차는 실제 강사 지정 없이 기록 거절');
select mt.cmd(mt.id(27), 'participation', jsonb_build_object('participant_id', (select part from c1), 'status', 'present', 'actual_minutes', 110, 'teacher_id', mt.id(25), 'learning_summary', '합성 지도 내용'));
select mt.eq((select actual_teacher_id from public.makeup_fulfillments where participant_id = (select part from c1)), mt.id(25), '가져온 회차의 실제 강사 기록');
select mt.eq((select string_agg(status, ',' order by id) from public.makeup_reservations where student_id = mt.id(61)), 'done,reserved,reserved', 'MU-X05 연결된 예약만 done, 형제 예약은 그대로');
select mt.eq((select count(*)::int from public.attendance_records where session_date = mt.d(0)), 0, 'MU-X05 명령은 출결·시수를 만들지 않는다');
-- 다시 연결해도 명령이 바꾼 내용은 충돌이 아니다(스냅샷을 함께 맞춘다).
select mt.eq(jsonb_array_length(mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(101))) -> 'warnings'), 0, '명령이 바꾼 예약은 체크섬 충돌이 아니다');

-- MU-075 연결된 일정 취소: 예약 행만 사라지고 원결석 칸·사유·메모는 그대로.
create temp table l4 as select mt.cmd(mt.id(27), 'link_legacy', jsonb_build_object('source_id', mt.id(104))) as r;
select mt.cmd(mt.id(27), 'cancel', jsonb_build_object('participant_id', (select r ->> 'participant_id' from l4), 'reason', '합성 일정 취소'),
  mt.rev('makeup_participants', (select (r ->> 'participant_id')::uuid from l4)));
select mt.eq((select count(*)::int from public.makeup_reservations where id = mt.id(104)), 0, 'MU-075 일정 취소 → 예약 행 삭제');
select mt.eq((select status::text || ':' || coalesce(session_units::text, '-') || ':' || note from public.attendance_records where id = mt.id(81)), 'absent:-:합성 사유' || chr(10) || '보강 예정', 'MU-075 원결석 칸·사유·메모 불변');
select mt.eq((select state || ':' || (snapshot ->> 'makeup_date') from public.makeup_legacy_maps where legacy_id = mt.id(104)), 'released:' || mt.d(5), 'MU-075 취소한 예약의 스냅샷 보존');
select mt.eq((select lifecycle || ':' || committed_minutes from public.makeup_cases where id = (select (r ->> 'id')::uuid from l4)), 'open:0', 'MU-075 건은 열린 채 남는다(무흔적 삭제 없음)');

-- MU-073·X14 꺼진 뒤에도 연결된 예약의 직접 삭제로 돌아가지 않는다(보호는 운영 모드와 무관).
select mt.as_command();
update public.tenant_settings set data = jsonb_set(data, '{makeups,mode}', '"off"') where tenant_id = mt.id(11);
select mt.end_command();
select mt.throws('delete from public.makeup_reservations where id = mt.id(101)', 'P0001', 'MU-073 꺼진 뒤에도 연결된 예약 직접 삭제 거절');
select mt.throws('select mt.cmd(mt.id(22), ''cancel'', ''{}''::jsonb, 1)', 'mode_off', 'MU-X14 꺼진 동안 새 명령은 거절');
delete from public.makeup_reservations where id = mt.id(103);
select mt.eq((select count(*)::int from public.makeup_reservations where id = mt.id(103)), 0, 'MU-X14 연결 안 된 예약은 꺼진 뒤에도 종전대로 삭제');
select count(*) as passed from mt.passed;
rollback;
