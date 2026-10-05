-- 닫힌 건의 뒤늦은 증거 변경 · 보고서 회수/삭제 · 연결 칸 직접 비우기 (잔여 7 — MU-010·031·034·053·075 · MU-X16·X17)
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 110) as a1, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 240) as b1;
create function pg_temp.job(p uuid) returns text language sql as $$ select state from public.makeup_projection_jobs where effect_key = 'att:' || p $$;
create function pg_temp.open_of(p_kind text, p_part uuid) returns integer language sql as $$
  select count(*)::int from public.makeup_reconciliation where kind = p_kind and participant_id = p_part and state = 'open' $$;
create function pg_temp.report(p_id uuid, p_student uuid) returns void language sql as $$
  insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, makeup, makeup_class_id, created_by, classnote_status, notes)
    values (p_id, mt.id(11), p_student, mt.d(0), 'math', true, mt.id(51), mt.id(25), 'success', '합성 보강 보고서') $$;
-- 학생A: 출결(보강 1.0) + 보낸 보고서를 증거로 끝까지 → 검토 → 자동 종결.
create temp table pa as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(301), mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'makeup', 1, mt.id(25));
select pg_temp.report(mt.id(501), mt.id(61));
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pa), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(301), 'report_id', mt.id(501)));
create temp table fa as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from pa))) ->> 'id')::uuid as id;
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fa), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110))), mt.rev('makeup_fulfillments', (select id from fa)));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select a1 from k)) || ':' || pg_temp.job((select id from pa)), 'closed:completed:done', '학생A의 건은 닫혔고 반영도 done');

-- ① 닫힌 뒤 출결 시수가 바뀌면(UPDATE) 닫힌 건에도 항목이 열리고, 목록·카드·끄기 검사에 보인다. 인정·수량은 그대로다.
update public.attendance_records set session_units = 3 where id = mt.id(301);
select mt.eq(pg_temp.open_of('units_mismatch', (select id from pa)) || ':' || pg_temp.job((select id from pa)), '1:failed', 'MU-X17 닫힌 건의 증거 변경 → 시수 대사가 열린다');
create temp table lc as select mt.run(mt.id(22), 'select public.makeup_list_cases(''{"tab":"closed"}'')') as r;
select mt.ok((select 'recon_open' = any (array(select jsonb_array_elements_text(x -> 'flags'))) from lc, jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = (select a1 from k)), '닫힌 탭의 그 건에 주의 표시가 붙는다');
select mt.eq((select (r -> 'counts' ->> 'closed_recon_open') || ':' || (r -> 'counts' ->> 'recon_open') from lc), '1:0', '닫힌 건의 확인 항목을 따로 센다(진행 중 건의 수와 섞지 않는다)');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_reconciliation(''{"kind":"units_mismatch"}'')') ->> 'total')::int, 1, '확인 필요 목록에 보인다');
select mt.cmd(mt.id(21), 'configure', '{"mode":"draining"}'::jsonb);
select mt.cmd_throws(mt.id(21), 'configure', '{"mode":"off"}'::jsonb, null, 'conflict', '닫힌 건의 뒤늦은 항목이 남아 있으면 끌 수 없다');
select mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb);
select mt.eq((select c.lifecycle || ':' || c.recognized_minutes || ':' || f.state from public.makeup_cases c, public.makeup_fulfillments f where c.id = (select a1 from k) and f.id = (select id from fa)),
  'closed:110:verified', 'MU-034 인정·종결·실시 기록은 자동으로 뒤집지 않는다(사람이 본다)');
update public.attendance_records set session_units = 1 where id = mt.id(301);
select mt.eq(pg_temp.open_of('units_mismatch', (select id from pa)) || ':' || pg_temp.job((select id from pa)), '0:done', '증거가 다시 맞으면 닫힌다');

-- ② 증거가 그대로면 주변 사정(담임 변경)이 지난 반영을 뒤집지 않는다. 증거가 바뀌면 다시 본다.
create temp table pb as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['3','4'], 110) as id;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(303), mt.id(11), mt.id(51), mt.id(62), mt.d(0), 'makeup', 1, mt.id(25));
select pg_temp.report(mt.id(502), mt.id(62));
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(303), 'report_id', mt.id(502)));
update public.classes set teacher_id = mt.id(26) where id = mt.id(51);
select mt.eq(mt.cmd(mt.id(24), 'reconcile', '{"reason":"합성 대사"}'::jsonb) -> 'run' ->> 'status', 'succeeded', '담임 변경 뒤 대사 실행');
select mt.eq(pg_temp.job((select id from pb)) || ':' || pg_temp.open_of('attendance_observed', (select id from pb)), 'done:0', '증거가 그대로인 반영은 담임이 바뀌어도 done 그대로(거짓 항목 없음)');
update public.attendance_records set note = '증거 변경', session_units = 1.5 where id = mt.id(303);
select mt.eq(pg_temp.job((select id from pb)), 'failed', '증거(출결 행)가 바뀌면 지금 사정으로 다시 판정한다');
update public.classes set teacher_id = mt.id(25) where id = mt.id(51);
update public.attendance_records set session_units = 1 where id = mt.id(303);
select mt.eq(pg_temp.job((select id from pb)), 'done', '원래대로 돌리면 done');

-- ③ 닫힌(완료) 건의 원결석이 출석으로 바뀌면 그 건에 원수업 충돌이 열린다.
insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(11), mt.id(51), mt.id(61), mt.d(-13), 'present', 1, mt.id(25));
select mt.eq((select state || ':' || blocks_close || ':' || (detail ->> 'case_lifecycle') from public.makeup_reconciliation where dedupe_key = 'source_conflict:' || (select a1 from k)),
  'open:true:closed', 'MU-010 보강을 끝낸 뒤 원결석이 출석으로 정정되면 닫힌 건에도 보인다');

-- ④ 연결한 보고서가 나중에 회수되면 항목이 열린다(닫힌 건 포함). 원장의 실시 기록·인정은 조용히 바뀌지 않는다.
update public.lesson_reports set classnote_status = 'processing' where id = mt.id(501);
select mt.eq(pg_temp.open_of('evidence_removed', (select id from pa)), 0, '발송 처리 중은 지나가는 상태라 항목을 열지 않는다');
update public.lesson_reports set classnote_status = 'recall_requested' where id = mt.id(501);
select mt.eq((select state || ':' || blocks_close || ':' || (detail ->> 'source') || ':' || (detail ->> 'code') || ':' || (detail ->> 'fulfillment_state') from public.makeup_reconciliation
  where dedupe_key = 'evidence_report:' || (select id from fa)), 'open:true:report:report_recalled:verified', 'MU-075 연결한 보고서 회수 → 근거 변경 항목(검토를 마친 닫힌 건)');
select mt.eq((select x ->> 'summary' from jsonb_array_elements(mt.run(mt.id(22), 'select public.makeup_list_reconciliation(''{"kind":"evidence_removed"}'')') -> 'rows') x),
  '보강 근거로 연결한 보고서가 회수되었습니다 — 근거를 다시 확인해 주세요', '화면용 요약');
select mt.eq((select f.state || ':' || f.report_id::text || ':' || c.recognized_minutes from public.makeup_fulfillments f, public.makeup_cases c where f.id = (select id from fa) and c.id = (select a1 from k)),
  'verified:' || mt.id(501) || ':110', '회수가 실시 기록·연결·인정을 조용히 바꾸지 않는다');
update public.lesson_reports set classnote_status = 'success' where id = mt.id(501);
select mt.eq(pg_temp.open_of('evidence_removed', (select id from pa)), 0, '다시 보낸(조건에 맞는) 보고서 → 항목이 스스로 닫힌다');
update public.lesson_reports set makeup = false where id = mt.id(501);
select mt.eq((select detail ->> 'code' from public.makeup_reconciliation where dedupe_key = 'evidence_report:' || (select id from fa) and state = 'open'), 'report_not_makeup', '보강 표시가 꺼져도 항목이 열린다');
-- ⑤ 보고서 삭제: 살아 있는 실시 기록의 보고서는 지울 수 없다. 인정을 되돌린 뒤에는 지워지고, 연결 칸만 빈다(다른 값은 그대로).
select mt.throws('delete from public.lesson_reports where id = mt.id(501)', 'P0001', '검토를 마친 실시 기록의 보고서 삭제 거절');
select mt.cmd(mt.id(22), 'reverse', jsonb_build_object('fulfillment_id', (select id from fa), 'reason', '근거 보고서 변경 — 인정 되돌림'), mt.rev('makeup_fulfillments', (select id from fa)));
select mt.eq(pg_temp.open_of('evidence_removed', (select id from pa)) || ':' || (select lifecycle || ':' || outstanding_minutes from public.makeup_cases where id = (select a1 from k)), '0:open:110',
  'MU-031 인정을 되돌리면 근거 항목이 닫히고 건은 다시 열린다(의무 복원)');
create temp table before as select to_jsonb(f) - 'report_id' - 'revision' - 'updated_at' as j from public.makeup_fulfillments f where f.id = (select id from fa);
delete from public.lesson_reports where id = mt.id(501);
select mt.ok((select f.report_id is null and to_jsonb(f) - 'report_id' - 'revision' - 'updated_at' = (select j from before) from public.makeup_fulfillments f where f.id = (select id from fa)),
  '되돌린 기록의 보고서는 지워진다 — 연결 칸만 비고 나머지 원장 값은 그대로');
-- ⑥ 연결 칸만 비우는 **직접 UPDATE**는 명령 밖에서 통과하지 못한다(바깥 행이 실제로 지워질 때의 참조 무결성 동작만 통과).
select mt.throws(format('update public.makeup_fulfillments set report_id = null where participant_id = %L', (select id from pb)), '42501', '실시 기록의 보고서 연결 직접 비우기 거절');
select mt.throws(format('update public.makeup_participants set attendance_record_id = null where id = %L', (select id from pb)), '42501', '참여의 출결 연결 직접 비우기 거절');
select mt.throws(format('update public.makeup_sessions set teacher_id = null where id = (select session_id from public.makeup_participants where id = %L)', (select id from pb)), '42501', '회차의 강사 직접 비우기 거절');
select mt.throws(format('update public.makeup_reservations set attendance_record_id = null where id = (select legacy_id from public.makeup_legacy_maps where participant_id = %L limit 1)', (select id from pb)),
  'P0001', '연결된 예약 행의 출결 연결 직접 비우기 거절');
select mt.eq((select p.attendance_record_id::text || ':' || f.report_id::text from public.makeup_participants p join public.makeup_fulfillments f on f.participant_id = p.id where p.id = (select id from pb)),
  mt.id(303) || ':' || mt.id(502), '거절된 뒤 연결은 그대로');
-- 바깥 행이 실제로 지워지면(출결 삭제) 연결 칸이 비고 근거 삭제 항목이 남는다 — 그 길은 그대로 열려 있다.
delete from public.attendance_records where id = mt.id(303);
select mt.eq((select coalesce(p.attendance_record_id::text, 'null') || ':' || coalesce(r.attendance_record_id::text, 'null') from public.makeup_participants p
  join public.makeup_legacy_maps m on m.participant_id = p.id join public.makeup_reservations r on r.id = m.legacy_id where p.id = (select id from pb)), 'null:null', '출결 행 삭제 → 참여·예약 행의 연결 칸만 빈다');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'evidence_removed' and participant_id = (select id from pb) and state = 'open' and blocks_close), 1, '근거 삭제 항목이 남는다');
select count(*) as passed from mt.passed;
rollback;
