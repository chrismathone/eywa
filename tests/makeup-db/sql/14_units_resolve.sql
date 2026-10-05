-- 시수 대조와 대사 해결 (보완 2·4 — MU-033·034·052 · MU-X03·X16·X17·X19)
-- d(-6) = 반1 정규 수업일: 예상 시수 = 정규 1.0 + 보강 1.0 = 2.0 · d(-5) = 반2 정규 수업일(강사나) · d(0) = 정규 없음.
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 240) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-13), 240) as c1, mt.approved_case(mt.id(64), mt.id(52), mt.d(-12), 240) as d1;
create function pg_temp.past(p_student uuid, p_case uuid, p_periods text[], p_date date) returns uuid language plpgsql as $$
declare v uuid := mt.reserved(mt.id(22), p_student, p_case, mt.d(0), p_periods, 110);
begin
  perform mt.backdate((select session_id from public.makeup_participants where id = v), p_date);
  return v;
end; $$;
create function pg_temp.att(p_id uuid, p_class uuid, p_student uuid, p_date date, p_status text, p_units numeric, p_by uuid, p_taught uuid default null)
returns void language sql as $$
  insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, taught_by)
    values (p_id, mt.id(11), p_class, p_student, p_date, p_status::public.attendance_status, p_units, p_by, p_taught) $$;
create function pg_temp.job(p uuid) returns text language sql as $$ select state from public.makeup_projection_jobs where effect_key = 'att:' || p $$;
create function pg_temp.recon(p_kind text, p_part uuid) returns public.makeup_reconciliation language sql as $$
  select r from public.makeup_reconciliation r where r.kind = p_kind and r.participant_id = p_part $$;
create function pg_temp.resolve(p_actor uuid, p_payload jsonb, p_rev integer) returns jsonb language sql as $$ select mt.cmd(p_actor, 'resolve_reconciliation', p_payload, p_rev) $$;

-- ① 요청에 예상 시수를 싣지 않아도 서버가 계산해 대조한다: 정규일 칸의 수기 2.5 ≠ 예상 2.0 → 실패 + 대사.
create temp table pa as select pg_temp.past(mt.id(61), (select a1 from k), array['5','6'], mt.d(-6)) as id;
select pg_temp.att(mt.id(301), mt.id(51), mt.id(61), mt.d(-6), 'present', 2.5, mt.id(25));
create temp table ra as select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pa), 'status', 'present', 'actual_minutes', 110,
  'attendance_record_id', mt.id(301), 'learning_summary', '합성 지도 내용')) as r;
select mt.eq((select (r ->> 'projection_state') || ':' || (r -> 'verification' ->> 'code') from ra), 'failed:units_mismatch', 'MU-X19 요청이 예상값을 안 보내도 서버가 차이를 찾는다');
select mt.eq((select (detail ->> 'expected_regular_units') || '+' || (detail ->> 'expected_makeup_units') || '=' || (detail ->> 'expected_units') || ' vs ' || (detail ->> 'actual_units') || ':' || blocks_close
  from pg_temp.recon('units_mismatch', (select id from pa))), '1.0+1.0=2.0 vs 2.5:true', 'MU-X19 정규 1.0 + 보강 1.0 = 2.0 대 수기 2.5 — 종결 차단 대사');
select mt.ok((select detail ? 'quantity_basis' from pg_temp.recon('units_mismatch', (select id from pa))), '대사에 그 달 그 반의 수납 기준을 함께 적는다');
-- ② 차이가 열려 있는 동안: 검토 거절 · 사유만으로 닫기 거절 · "다시 반영"도 done이 되지 않는다.
create temp table fa as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from pa))) ->> 'id')::uuid as id;
select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fa), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110))),
  mt.rev('makeup_fulfillments', (select id from fa)), 'conflict', 'MU-X19 시수 차이가 열려 있으면 검토 거절');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch', (select id from pa))), 'reason', '확인함'),
  (select revision from pg_temp.recon('units_mismatch', (select id from pa))), 'conflict', '사유만으로는 시수 대사를 닫지 못한다');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch', (select id from pa))), 'reason', '확인함', 'status', 'dismissed', 'accept_manual_units', true),
  (select revision from pg_temp.recon('units_mismatch', (select id from pa))), 'conflict', '무시(dismissed)로도 닫지 못한다');
create temp table ja as select id, revision from public.makeup_projection_jobs where effect_key = 'att:' || (select id from pa);
select mt.cmd_throws(mt.id(24), 'resolve_reconciliation', jsonb_build_object('projection_id', (select id from ja), 'status', 'done', 'reason', '합성'), (select revision from ja) + 7, 'stale_revision', '옛 화면의 재반영 요청 거절');
select mt.eq(pg_temp.resolve(mt.id(24), jsonb_build_object('projection_id', (select id from ja), 'status', 'done', 'reason', '완료로 해 주세요'), (select revision from ja)) ->> 'projection_state',
  'failed', 'MU-052·X16 요청이 done을 보내도 사실이 어긋나면 failed(성공으로 위장하지 않는다)');
select mt.eq(pg_temp.job((select id from pa)), 'failed', '반영 작업은 그대로 failed');
select mt.eq((select (b ->> 'projections') || ':' || (b ->> 'reconciliation') from makeup_private.close_blockers(mt.id(11), (select a1 from k)) b), '1:1', '미결 작업 1 · 대사 1이 이 건의 종결을 막는다');
-- ③ 닫히는 길 1: 승인 권한자의 명시적 승인(사유 + 표시). 시수는 고치지 않고, 승인한 값을 감사로그에 남긴다.
select mt.cmd_throws(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch', (select id from pa))), 'reason', '합성', 'accept_manual_units', true),
  (select revision from pg_temp.recon('units_mismatch', (select id from pa))), 'forbidden', '차이 승인은 승인 권한자만');
select pg_temp.resolve(mt.id(22), jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_mismatch', (select id from pa))), 'reason', '정규 수업을 30분 더 한 날 — 수기 2.5 유지', 'accept_manual_units', true),
  (select revision from pg_temp.recon('units_mismatch', (select id from pa))));
select mt.eq((select state || ':' || (detail ->> 'accepted') || ':' || (detail ->> 'accepted_by') from pg_temp.recon('units_mismatch', (select id from pa))) || ':' || pg_temp.job((select id from pa)),
  'resolved:true:' || mt.id(22) || ':done', 'MU-X19 명시적 승인 → 대사 닫힘 + 작업 done(승인자 기록)');
select mt.eq((select count(*)::int from public.audit_logs where action = 'makeup_accept_units' and metadata -> 'detail' ->> 'actual_units' = '2.5'), 1, '승인한 실제 시수를 감사로그에 남긴다');
select mt.eq((select session_units from public.attendance_records where id = mt.id(301)), 2.5, 'MU-034 승인도 시수를 고치지 않는다');
select mt.ok((mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fa), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110))),
  mt.rev('makeup_fulfillments', (select id from fa))) ->> 'id') is not null, '승인 뒤에는 검토가 통과한다');
-- ④ 승인한 값이 다시 바뀌면(UPDATE) 같은 대사가 다시 열린다. 맞는 값으로 정정하면 스스로 닫힌다(닫히는 길 2).
update public.attendance_records set session_units = 3 where id = mt.id(301);
select mt.eq((select state || ':' || coalesce(detail ->> 'accepted', 'none') || ':' || (detail ->> 'actual_units') from pg_temp.recon('units_mismatch', (select id from pa))) || ':' || pg_temp.job((select id from pa)),
  'open:none:3.0:failed', 'MU-X17 승인 뒤 시수가 바뀌면(UPDATE 관측) 다시 열린다 — 옛 승인이 새 값을 덮지 않는다');
select mt.eq((select state from public.makeup_fulfillments where id = (select id from fa)), 'verified', '이미 한 인정은 자동으로 뒤집지 않는다(사람이 본다)');
update public.attendance_records set session_units = 2 where id = mt.id(301);
select mt.eq((select state from pg_temp.recon('units_mismatch', (select id from pa))) || ':' || pg_temp.job((select id from pa)), 'resolved:done', '출결을 예상값으로 정정하면 대사가 닫히고 done');

-- ⑤ 클라이언트가 보낸 예상·수기 값은 권위가 아니다: 틀린 값을 보내도 실제 2.0 = 서버 예상 2.0이면 통과.
create temp table pb as select pg_temp.past(mt.id(62), (select b1 from k), array['1','2'], mt.d(-6)) as id;
select pg_temp.att(mt.id(302), mt.id(51), mt.id(62), mt.d(-6), 'present', 2, mt.id(25));
create temp table rb as select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'present', 'actual_minutes', 110,
  'attendance_record_id', mt.id(302), 'learning_summary', '합성', 'manual_units', 9, 'expected_makeup_units', 8, 'expected_total_units', 9)) as r;
select mt.eq((select (r ->> 'projection_state') || ':' || (r -> 'verification' ->> 'expected_units') from rb), 'done:2.0', '틀린 주장값을 보내도 서버 계산(2.0)으로 판정한다');
select mt.eq((select expected_makeup_units from public.makeup_participants where id = (select id from pb)), 1.0, '참여에 남는 예상 보강분도 서버 값(1.0)');
-- 기존 자동 시수 규칙과 같다: 자리 교시(LAB실 등)는 수업 분에서 빼고, 같은 시작 시각은 한 번만 센다.
insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from, slot_teacher_label)
  values (mt.id(11), mt.id(51), mt.dow(mt.d(-6)), '21:00', '22:00', mt.d(-200), 'LAB실');
insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
  select tenant_id, class_id, day_of_week, start_time, end_time, valid_from from public.class_schedules where id = mt.id(71);
select mt.eq((mt.run(mt.id(25), format('select public.makeup_projection_evidence(%L)', 'att:' || (select id from pb))) -> 'verification' ->> 'expected_regular_units'), '1.0',
  '자리 교시·중복 시작 시각이 있어도 정규 예상 시수는 1.0(기존 자동 시수와 같은 식)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(26), format('select public.makeup_projection_evidence(%L)', 'att:' || (select id from pb))), 'not_found', '증거 조회도 범위 밖은 없음으로');
-- 자동 시수를 쓰지 않는 지점(preset = generic)은 시수를 대조하지 않는다(수기 값을 문제 삼지 않는다).
update public.tenant_settings set data = data || '{"preset":"generic"}'::jsonb where tenant_id = mt.id(11);
update public.attendance_records set session_units = 7 where id = mt.id(302);
select mt.eq(pg_temp.job((select id from pb)) || ':' || (select payload -> 'verification' ->> 'units_checked' from public.makeup_projection_jobs where effect_key = 'att:' || (select id from pb)), 'done:false', '자동 시수 미사용 지점: 시수 대조 건너뜀');
update public.tenant_settings set data = data - 'preset' where tenant_id = mt.id(11);
update public.attendance_records set session_units = 2 where id = mt.id(302);

-- ⑥ 일부 참여는 보강분 시수를 정할 수 없다 → 시수 확인 대사(사람이 본다). 정정 이력으로 덮인 옛 출결 행은 연결 거절.
create temp table pc as select mt.reserved(mt.id(22), mt.id(63), (select c1 from k), mt.d(0), array['3','4'], 110) as id;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, recorded_at)
  values (mt.id(305), mt.id(11), mt.id(51), mt.id(63), mt.d(0), 'makeup', 1, mt.id(25), now() - interval '1 hour');
select pg_temp.att(mt.id(303), mt.id(51), mt.id(63), mt.d(0), 'makeup', 1, mt.id(25));
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pc), 'status', 'partial', 'actual_minutes', 60, 'attendance_record_id', mt.id(305)), null, 'invalid', '정정으로 덮인 옛 출결 행 연결 거절');
select mt.eq(mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pc), 'status', 'partial', 'actual_minutes', 60, 'attendance_record_id', mt.id(303))) -> 'verification' ->> 'code',
  'units_unknown', '일부 참여는 예상 시수를 정하지 못한다');
select mt.eq((select kind || ':' || blocks_close from pg_temp.recon('units_review', (select id from pc))), 'units_review:true', 'MU-X17 일부 참여 → 시수 확인 대사(종결 차단)');
select pg_temp.resolve(mt.id(22), jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('units_review', (select id from pc))), 'reason', '60분 지도 — 시수 1.0 유지', 'accept_manual_units', true),
  (select revision from pg_temp.recon('units_review', (select id from pc))));
select mt.eq((select state from pg_temp.recon('units_review', (select id from pc))) || ':' || pg_temp.job((select id from pc)), 'resolved:done', '일부 참여의 시수도 승인 권한자가 확인하면 닫힌다');

-- ⑦ 같은 날 정규 수업의 강사(강사나)와 보강 강사(강사가)가 다르면 한 칸에 함께 기록할 수 없다.
create temp table pd as select pg_temp.past(mt.id(64), (select d1 from k), array['5','6'], mt.d(-5)) as id;
select pg_temp.att(mt.id(304), mt.id(52), mt.id(64), mt.d(-5), 'present', 2, mt.id(26), mt.id(25));
select mt.cmd_throws(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pd), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(304), 'learning_summary', '합성'),
  null, 'invalid', 'MU-033·X03 정규 강사와 보강 강사가 다른 칸은 연결 거절');
select mt.eq(mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pd), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성')) -> 'verification' ->> 'code',
  'regular_teacher_differs', '출결 행을 주지 않아도 서버가 그 칸을 찾아 같은 판정을 한다');
select mt.eq((select kind || ':' || blocks_close || ':' || (detail ->> 'code') from pg_temp.recon('attendance_observed', (select id from pd))), 'attendance_observed:true:regular_teacher_differs', '귀속 불일치 대사(종결 차단)');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from pg_temp.recon('attendance_observed', (select id from pd))), 'reason', '확인'),
  (select revision from pg_temp.recon('attendance_observed', (select id from pd))), 'conflict', '귀속 불일치도 사유만으로는 닫히지 않는다');
-- 안 왔다는 기록에는 귀속 강사를 묻지 않는다: 다른 강사 반의 결석 칸도 그대로 연결된다.
create temp table pe as select mt.reserved(mt.id(22), mt.id(65), mt.approved_case(mt.id(65), mt.id(52), mt.d(-12), 120), mt.d(0), array['5','6'], 110) as id;
select pg_temp.att(mt.id(306), mt.id(52), mt.id(65), mt.d(0), 'absent', null, mt.id(26));
select mt.eq(mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pe), 'status', 'no_show', 'actual_minutes', 0, 'attendance_record_id', mt.id(306))) ->> 'projection_state',
  'done', '노쇼 + 결석 칸(다른 강사 반)은 귀속 검사 없이 맞는 것으로 본다');
-- 분만 고쳐 다시 기록할 때는 이미 남긴 지도 근거가 증거로 이어진다(근거를 다시 요구하지 않는다).
select mt.eq(mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pd), 'status', 'present', 'actual_minutes', 100)) ->> 'evidence_kind', 'manual', '분 정정 재기록 — 남겨 둔 근거 유지');
select mt.eq((select string_agg(coalesce(session_units::text, '-'), ',' order by id) from public.attendance_records where id in (mt.id(301), mt.id(302), mt.id(303), mt.id(304), mt.id(306))), '2.0,2.0,1.0,2.0,-', 'MU-034 원장은 어느 경로에서도 시수를 쓰지 않았다(사람이 고친 값 그대로)');
select count(*) as passed from mt.passed;
rollback;
