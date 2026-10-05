-- 승인된 수기 시수의 권위 있는 검증 · 닫힌 건의 노쇼 되돌리기 거절 · 수납 기준 표 (잔여 4·5·6 — MU-020·031·034·035 · MU-X11·X19)
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 110) as b1;
create function pg_temp.job(p uuid) returns jsonb language sql as $$
  select jsonb_build_object('state', j.state) || (j.payload -> 'verification') from public.makeup_projection_jobs j where j.effect_key = 'att:' || p $$;
create function pg_temp.evidence(p uuid) returns jsonb language sql as $$ select mt.run(mt.id(25), format('select public.makeup_projection_evidence(%L)', 'att:' || p)) $$;
create function pg_temp.recon(p_kind text, p_part uuid) returns public.makeup_reconciliation language sql as $$
  select r from public.makeup_reconciliation r where r.kind = p_kind and r.participant_id = p_part $$;
create function pg_temp.accept(p_kind text, p_part uuid) returns jsonb language sql as $$
  select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (pg_temp.recon(p_kind, p_part)).id,
    'reason', '수기 시수 유지 승인', 'accept_manual_units', true), (pg_temp.recon(p_kind, p_part)).revision) $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare d text; begin execute p_sql; return 'no error'; exception when others then get stacked diagnostics d = pg_exception_detail; return d; end; $$;

-- ① 정규 수업일(d(-6): 예상 2.0)의 칸이 수기 2.5 → 시수 차이. 승인하면 검증이 **ok = true · accepted_manual_units** 를 돌려준다.
create temp table pa as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['5','6'], 110) as id;
select mt.backdate((select session_id from public.makeup_participants where id = (select id from pa)), mt.d(-6));
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(301), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'present', 2.5, mt.id(25));
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pa), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(301), 'learning_summary', '합성'));
create temp table fa as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from pa))) ->> 'id')::uuid as id;
select mt.eq(pg_temp.job((select id from pa)) ->> 'state' || ':' || (pg_temp.job((select id from pa)) ->> 'ok') || ':' || (pg_temp.job((select id from pa)) ->> 'code'), 'failed:false:units_mismatch', '승인 전: 실패 · ok = false');
create temp table acc as select pg_temp.accept('units_mismatch', (select id from pa)) as r;
select mt.eq((select (r ->> 'state') || ':' || (r -> 'verification' ->> 'ok') || ':' || (r -> 'verification' ->> 'code') || ':' || (r -> 'verification' ->> 'accepted_code') from acc),
  'resolved:true:accepted_manual_units:units_mismatch', 'MU-X19 승인 명령의 응답이 권위 있는 검증 결과를 싣는다(ok = true · accepted_manual_units)');
select mt.eq((select (j ->> 'state') || ':' || (j ->> 'ok') || ':' || (j ->> 'code') || ':' || (j ->> 'accepted_by') || ':' || (j ->> 'actual_units') from pg_temp.job((select id from pa)) j),
  'done:true:accepted_manual_units:' || mt.id(22) || ':2.5', '반영 작업: done이면서 검증도 ok(승인자 · 승인한 실제 시수 기록)');
select mt.eq((select (e ->> 'state') || ':' || (e -> 'verification' ->> 'ok') || ':' || (e -> 'verification' ->> 'code') || ':' || (e -> 'evidence' ->> 'session_units') from pg_temp.evidence((select id from pa)) e),
  'done:true:accepted_manual_units:2.5', '증거 조회 RPC도 같은 판정을 돌려준다(done인데 ok = false인 모순이 없다)');
select mt.ok((select detail -> 'accepted_snapshot' ?& array['attendance_record_id', 'status', 'session_units', 'taught_by', 'anchor_class_id', 'participation', 'session_teacher_id']
  from pg_temp.recon('units_mismatch', (select id from pa))), '승인은 그 순간의 증거(출결 행·상태·시수·귀속 강사·출결 반·참여 상태·회차 강사)를 함께 적는다');
select mt.eq((select session_units from public.attendance_records where id = mt.id(301)), 2.5, 'MU-034 승인은 시수를 고치지 않는다');
-- ② 옛 승인은 바뀐 증거를 덮지 못한다: 귀속 강사가 바뀌면 다른 불일치로 실패하고, 원래대로 돌아오면 그 승인이 다시 맞는다.
update public.attendance_records set taught_by = mt.id(26) where id = mt.id(301);
select mt.eq((select (e ->> 'state') || ':' || (e -> 'verification' ->> 'ok') || ':' || (e -> 'verification' ->> 'code') from pg_temp.evidence((select id from pa)) e),
  'failed:false:attendance_other_teacher', '귀속 강사가 바뀐 증거: 옛 승인으로 ok가 되지 않는다');
select mt.eq((select state from pg_temp.recon('attendance_observed', (select id from pa))), 'open', '바뀐 증거의 불일치가 새 항목으로 열린다');
update public.attendance_records set taught_by = null where id = mt.id(301);
select mt.eq((select (j ->> 'state') || ':' || (j ->> 'code') from pg_temp.job((select id from pa)) j) || ':' || (select state from pg_temp.recon('attendance_observed', (select id from pa))),
  'done:accepted_manual_units:resolved', '승인한 그 증거로 정확히 돌아오면 승인이 다시 유효하다');
-- 상태만 바뀌어도(시수 2.5 그대로) 승인한 증거가 아니다 → 같은 시수 대사가 승인 표시 없이 다시 열린다.
update public.attendance_records set status = 'late' where id = mt.id(301);
select mt.eq((select state || ':' || coalesce(detail ->> 'accepted', 'none') || ':' || (detail ? 'accepted_snapshot') from pg_temp.recon('units_mismatch', (select id from pa))),
  'open:none:false', 'MU-X19 상태가 바뀐 증거: 승인이 사라지고 시수 대사가 다시 열린다');
select mt.eq((select (e -> 'verification' ->> 'ok') || ':' || (e -> 'verification' ->> 'code') || ':' || (e ->> 'state') from pg_temp.evidence((select id from pa)) e), 'false:units_mismatch:failed', '증거 조회도 ok = false로 돌아간다');
select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fa), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110))),
  mt.rev('makeup_fulfillments', (select id from fa)), 'conflict', '승인이 무효가 된 동안에는 검토도 거절');
-- 정정 이력으로 새 행이 생겨도(값이 같아도) 승인한 그 행이 아니다. 새 증거를 다시 승인해야 한다.
select pg_temp.accept('units_mismatch', (select id from pa));
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, supersedes_id)
  values (mt.id(302), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'late', 2.5, mt.id(25), mt.id(301));
select mt.eq((select state || ':' || coalesce(detail ->> 'accepted', 'none') || ':' || attendance_record_id::text from pg_temp.recon('units_mismatch', (select id from pa))),
  'open:none:' || mt.id(302), '새 출결 행(같은 값)도 옛 승인으로 통과하지 않는다');
select mt.eq(pg_temp.accept('units_mismatch', (select id from pa)) -> 'verification' ->> 'code', 'accepted_manual_units', '새 증거를 다시 승인');
select mt.ok((mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fa), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110))),
  mt.rev('makeup_fulfillments', (select id from fa))) ->> 'id') is not null, '유효한 승인 아래에서는 검토가 통과한다');
select mt.eq((select count(*)::int from public.audit_logs where action = 'makeup_accept_units'), 3, '승인마다 감사로그(3번)');

-- ③ 닫힌 건의 노쇼는 되돌리지 못한다: 노쇼 → 남은 분량 면제로 종결 → 왔다로 정정 시도 = 거절(닫힌 건에 약속을 되살리지 않는다).
create temp table pb as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['1','2'], 110) as id;
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'no_show'));
select mt.cmd(mt.id(22), 'waive', jsonb_build_object('case_id', (select b1 from k), 'minutes', 110, 'reason', '합성 면제'), mt.rev('makeup_cases', (select b1 from k)));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select b1 from k)), 'closed:waived', '노쇼 뒤 전량 면제 → 종결');
create temp table e1 as select pg_temp.err(format('select mt.cmd(%L::uuid, %L, %L::jsonb)', mt.id(25), 'participation',
  jsonb_build_object('participant_id', (select id from pb), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성'))) as d;
select mt.ok((select d like '%"code": "conflict"%' and d like '%case_closed%' from e1), 'MU-020 닫힌 건의 노쇼 되돌리기 거절(사유 = case_closed)');
select mt.eq((select p.status || ':' || al.released_minutes || ':' || al.release_reason from public.makeup_participants p join public.makeup_allocations al on al.participant_id = p.id where p.id = (select id from pb)),
  'no_show:110:no_show', '참여는 노쇼 그대로 · 풀린 배정도 그대로');
select mt.eq((select lifecycle || ':' || committed_minutes || ':' || waived_minutes || ':' || outstanding_minutes from public.makeup_cases where id = (select b1 from k)), 'closed:0:110:0', '닫힌 건의 수량은 그대로(약속이 되살아나지 않았다)');
select mt.eq((select count(*)::int from public.makeup_fulfillments where participant_id = (select id from pb) and state <> 'reversed'), 0, '실시 기록도 생기지 않았다');
-- 명시적인 길: 새 건을 접수·승인해 새 일정으로 잡는다.
select mt.ok(mt.reserved(mt.id(22), mt.id(62), mt.approved_case(mt.id(62), mt.id(51), mt.d(-20), 110), mt.d(3), array['1','2'], 110) is not null, '새 보강 건의 새 일정은 잡힌다');

-- ④ 수납 기준(0267a) 표: 확정 전 = 시수 합 · 확정 = 그 행의 기준 · 🔴 확정인데 기준 칸이 비면 일수(days) 호환 · 행 없음 = none.
create function pg_temp.basis(p_student uuid, p_class uuid default mt.id(51)) returns text language sql as $$
  select makeup_private.billing_basis(mt.id(11), p_student, p_class, mt.d(0)) $$;
alter table public.invoice_session_terms alter column quantity_basis drop not null;
create function pg_temp.term(p_invoice uuid, p_student uuid, p_confirmed numeric, p_basis text, p_period text default to_char(mt.d(0), 'YYYY-MM')) returns void language sql as $$
  insert into public.invoices (id, tenant_id, student_id, period, amount_total, line_items) values (p_invoice, mt.id(11), p_student, p_period, 100000, '[]'::jsonb);
  insert into public.invoice_session_terms (tenant_id, invoice_id, subject, class_id, confirmed_sessions, quantity_basis)
    values (mt.id(11), p_invoice, 'math', mt.id(51), p_confirmed, p_basis) $$;
select mt.eq(pg_temp.basis(mt.id(63)), 'none', '청구 회차 행 없음 → none');
select pg_temp.term(mt.id(401), mt.id(63), null, 'days');
select mt.eq(pg_temp.basis(mt.id(63)), 'attendance_units', '확정 전(확정 회차 없음) → 시수 합');
update public.invoice_session_terms set confirmed_sessions = 8 where invoice_id = mt.id(401);
select mt.eq(pg_temp.basis(mt.id(63)), 'days', '확정 + days → 일수');
update public.invoice_session_terms set quantity_basis = 'attendance_units' where invoice_id = mt.id(401);
select mt.eq(pg_temp.basis(mt.id(63)), 'attendance_units', '확정 + attendance_units → 시수 합');
update public.invoice_session_terms set quantity_basis = null where invoice_id = mt.id(401);
select mt.eq(pg_temp.basis(mt.id(63)), 'days', 'MU-X11 확정인데 기준 칸이 비어 있음 → 일수(days) 호환 — none이 아니다');
update public.invoice_session_terms set confirmed_sessions = null where invoice_id = mt.id(401);
select mt.eq(pg_temp.basis(mt.id(63)), 'attendance_units', '확정 전 + 기준 칸 비어 있음 → 시수 합');
update public.invoice_session_terms set confirmed_sessions = 8 where invoice_id = mt.id(401);
update public.invoices set status = 'void' where id = mt.id(401);
select mt.eq(pg_temp.basis(mt.id(63)), 'none', '무효 처리한 청구의 행은 빼고 본다 → 남은 행이 없으면 none');
select mt.throws($$select pg_temp.term(mt.id(402), mt.id(63), 8, null)$$, '23505', '학생·청구월마다 청구는 1건이다(확정 전·확정 행이 한 달에 겹치지 않는다)');
select pg_temp.term(mt.id(403), mt.id(64), 8, null, to_char(mt.d(0) - 62, 'YYYY-MM'));
select mt.eq(pg_temp.basis(mt.id(64)), 'none', '다른 달의 청구 행은 그 달의 기준이 아니다');
select mt.eq(pg_temp.basis(mt.id(63), mt.id(52)) || ':' || makeup_private.billing_basis(mt.id(11), mt.id(63), null, mt.d(0)), 'none:unknown', '다른 반 = none · 출결 반을 모르면 unknown');
select count(*) as passed from mt.passed;
rollback;
