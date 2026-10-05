-- 같은 날 정규 귀속과 보강 강사 — 예약과 검증이 그날의 **지금 유효한 출결 칸 전부**를 본다 (계획 25·31행 · MU-033 · MU-X03)
-- d(0) = 반1(시간표 담당 = 강사가 25)의 정규 수업일(3~4교시). 보강은 그 밖의 교시. 예상 시수 = 정규 1.0 + 보강 0.5 = 1.5.
-- 판정 순서: ① 그날 그 반에 찍힌 담당(교시마다 최신 정정 · 시수 상태인 칸만)이 있으면 전부 보강 강사여야 한다
--            ② 시간표 담당도 보강 강사여야 한다(종전 규칙 그대로 — 찍힌 담당이 시간표를 대신하지 않는다).
--   예약은 검증이 붙잡을 것을 미리 거절한다. 대체 수업이면 시간표 담당을 먼저 고친 뒤 예약한다.
begin;
select mt.seed_on();
select mt.login(null);
insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
  select mt.id(73), mt.id(11), mt.id(51), mt.dow(mt.d(0)), min(t.start_time), max(t.end_time), mt.d(-200)
    from makeup_private.period_table(mt.id(11), 'math', mt.d(0)) t where t.ord in (3, 4);
create temp table t4 as select t.start_time as s from makeup_private.period_table(mt.id(11), 'math', mt.d(0)) t where t.ord = 4;
insert into public.students (id, tenant_id, name) select mt.id(80 + g), mt.id(11), '합성학생' || g from generate_series(1, 8) g;
insert into public.enrollments (tenant_id, student_id, class_id, start_date) select mt.id(11), mt.id(80 + g), mt.id(51), mt.d(-200) from generate_series(1, 8) g;
create temp table k as select g, mt.approved_case(mt.id(80 + g), mt.id(51), mt.d(-13), 240) as c from generate_series(1, 8) g;

create function pg_temp.bk(p_g integer, p_teacher integer, p_period text) returns jsonb language sql as $$
  select jsonb_build_object('student_id', mt.id(80 + p_g), 'session_date', mt.d(0), 'period_ids', jsonb_build_array(p_period),
    'teacher_id', mt.id(p_teacher), 'classroom_id', mt.id(41), 'anchor_class_id', mt.id(51),
    'allocations', jsonb_build_array(jsonb_build_object('case_id', (select c from k where g = p_g), 'minutes', 55))) $$;
-- 예약을 시도하고 결과를 돌려준다: booked · 거절 사유(reason) · 사유가 없으면 오류 코드.
create function pg_temp.why(p jsonb) returns text language plpgsql as $$
declare d text;
begin
  perform mt.cmd(mt.id(22), 'reserve', p);
  return 'booked';
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return coalesce(d::jsonb ->> 'reason', d::jsonb ->> 'code');
end; $$;
create function pg_temp.att(p_id integer, p_g integer, p_status text, p_taught integer, p_slot time default null, p_units numeric default null,
  p_at timestamptz default now()) returns void language sql as $$
  insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, slot_start, status, session_units, recorded_by, taught_by, recorded_at)
    values (mt.id(p_id), mt.id(11), mt.id(51), mt.id(80 + p_g), mt.d(0), p_slot, p_status::public.attendance_status, p_units, mt.id(25),
      case when p_taught is not null then mt.id(p_taught) end, p_at) $$;
create function pg_temp.part(p uuid, p_att integer default null) returns jsonb language sql as $$
  select jsonb_build_object('participant_id', p, 'status', 'present', 'actual_minutes', 55, 'learning_summary', '합성 지도 내용')
      || case when p_att is null then '{}'::jsonb else jsonb_build_object('attendance_record_id', mt.id(p_att)) end $$;
create function pg_temp.code(p uuid) returns text language sql as $$
  select coalesce(v ->> 'code', case when (v ->> 'ok')::boolean then 'ok' end) from makeup_private.verify_attendance_effect(mt.id(11), p) v $$;
create function pg_temp.job(p uuid) returns text language sql as $$ select state from public.makeup_projection_jobs where effect_key = 'att:' || p $$;
create function pg_temp.held(p uuid) returns text language sql as $$
  select coalesce(string_agg(r.kind || ':' || (r.detail ->> 'code'), ',' order by r.kind), 'none') from public.makeup_reconciliation r
   where r.participant_id = p and r.state = 'open' and r.blocks_close $$;

-- ① 예약 — 찍힌 담당이 없으면 시간표로 본다(종전 그대로).
select mt.eq(pg_temp.why(pg_temp.bk(1, 26, '1')), 'conflict', '출결이 없는 날: 시간표 담당과 다른 보강 강사는 거절(종전)');
select mt.eq(pg_temp.why(pg_temp.bk(1, 25, '1')), 'booked', '출결이 없는 날: 시간표 담당과 같으면 예약된다(종전)');
-- ② 예약 — 찍힌 담당이 보강 강사와 다르면 거절한다(시간표가 같아도). 찍힌 담당만 같고 시간표가 다르면 그것도 거절한다.
select pg_temp.att(201, 2, 'present', 26);
select mt.eq(pg_temp.why(pg_temp.bk(2, 25, '2')), 'attendance_teacher_differs', 'MU-033 대체 강사가 찍힌 날은 시간표 담당 이름으로 예약할 수 없다');
select mt.eq(pg_temp.why(pg_temp.bk(2, 26, '2')), 'conflict', '찍힌 담당과 같아도 시간표 담당이 다르면 거절(검증이 붙잡을 예약을 만들지 않는다)');
-- ③ 예약 — 교시 칸이 섞인 날: 한 칸이라도 다른 담당이면 거절.
select pg_temp.att(202, 3, 'present', 25);
select pg_temp.att(203, 3, 'present', 26, (select s from t4));
select mt.eq(pg_temp.why(pg_temp.bk(3, 25, '2')), 'attendance_teacher_differs', 'MU-X03 그날 전체 칸은 같아도 다른 교시 칸의 담당이 다르면 거절');
-- ④ 예약 — 같은 칸의 정정은 최신 한 줄만 본다.
select pg_temp.att(204, 4, 'present', 25, null, null, now() - interval '2 hours');
select pg_temp.att(205, 4, 'present', 26, null, null, now() - interval '1 hour');
select mt.eq(pg_temp.why(pg_temp.bk(4, 25, '2')), 'attendance_teacher_differs', '정정으로 담당이 바뀐 칸: 최신 값(다른 강사)으로 거절');
select pg_temp.att(206, 5, 'present', 26, null, null, now() - interval '2 hours');
select pg_temp.att(207, 5, 'present', 25, null, null, now() - interval '1 hour');
select mt.eq(pg_temp.why(pg_temp.bk(5, 25, '2')), 'booked', '정정으로 덮인 옛 담당은 세지 않는다 — 최신 값이 보강 강사면 예약된다');
-- ⑤ 예약 — 시수 상태가 아닌 칸의 담당은 세지 않는다 · 찍힌 담당과 시간표가 모두 같으면 예약된다.
select pg_temp.att(208, 6, 'absent', 26, (select s from t4));
select pg_temp.att(209, 6, 'present', 25);
select mt.eq(pg_temp.why(pg_temp.bk(6, 25, '5')), 'booked', '결석 칸의 담당은 세지 않는다 · 찍힌 담당 = 시간표 담당 = 보강 강사면 예약된다');

-- ⑥ 검증 — 그날 전체 칸(강사가)과 다른 교시 칸(강사나)이 함께 있으면 붙잡는다. 어느 행이 최신인지와 무관하다.
create temp table pv as select (mt.cmd(mt.id(22), 'reserve', pg_temp.bk(7, 25, '6')) ->> 'participant_id')::uuid as id;
select pg_temp.att(211, 7, 'present', 25, null, null, now() - interval '2 hours');
select pg_temp.att(212, 7, 'present', 26, (select s from t4), null, now() - interval '1 hour');
select mt.cmd_throws(mt.id(25), 'participation', pg_temp.part((select id from pv), 211), null, 'invalid',
  'MU-X03 그날 전체 칸을 직접 연결해도 다른 교시 칸의 담당이 다르면 거절(연결한 칸 하나가 다른 칸을 덮지 않는다)');
select mt.eq(mt.cmd(mt.id(25), 'participation', pg_temp.part((select id from pv))) -> 'verification' ->> 'code', 'regular_teacher_differs',
  '출결 행을 주지 않아도 서버가 그날의 칸 전부를 보고 같은 판정을 한다');
select mt.eq(pg_temp.held((select id from pv)), 'attendance_observed:regular_teacher_differs', '귀속이 갈린 날 → 종결 차단 항목');
update public.attendance_records set recorded_at = now() where id = mt.id(211);
select mt.eq(pg_temp.code((select id from pv)), 'regular_teacher_differs', '그날 전체 칸이 최신이 되어도 판정이 같다(행 순서와 무관)');
update public.attendance_records set session_units = 1.5 where id = mt.id(211);
select mt.eq(pg_temp.code((select id from pv)) || ':' || pg_temp.job((select id from pv)), 'regular_teacher_differs:failed',
  '그 칸에 정규+보강 시수(1.5)가 들어가도 맞음으로 닫히지 않는다');
create temp table fv as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from pv))) ->> 'id')::uuid as id;
select mt.cmd_throws(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from fv), 'recognitions',
  jsonb_build_array(jsonb_build_object('case_id', (select c from k where g = 7), 'minutes', 55))), mt.rev('makeup_fulfillments', (select id from fv)),
  'conflict', '귀속이 갈린 채로는 인정하지 않는다');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select r.id from public.makeup_reconciliation r
    where r.participant_id = (select id from pv) and r.kind = 'attendance_observed' and r.state = 'open'), 'reason', '확인'),
  (select r.revision from public.makeup_reconciliation r where r.participant_id = (select id from pv) and r.kind = 'attendance_observed' and r.state = 'open'),
  'conflict', '귀속 불일치는 사유만으로 닫히지 않는다(종전 보호 유지)');

-- ⑦ 검증 — 같은 담당이면 종전처럼 합쳐진다. 그 뒤 다른 칸이 더 최신이 되어도 판정·연결이 그대로다.
update public.attendance_records set taught_by = mt.id(25) where id = mt.id(212);
select mt.eq(pg_temp.code((select id from pv)) || ':' || pg_temp.held((select id from pv)), 'ok:none', '다른 칸의 담당을 같은 강사로 고치면 맞음 · 항목이 닫힌다');
select mt.eq(mt.cmd(mt.id(25), 'participation', pg_temp.part((select id from pv), 211)) ->> 'projection_state', 'done', '같은 담당의 정규+보강은 종전처럼 반영 완료');
update public.attendance_records set recorded_at = now() + interval '1 minute' where id = mt.id(212);
select mt.eq(pg_temp.job((select id from pv)) || ':' || (select (attendance_record_id = mt.id(211))::text from public.makeup_participants where id = (select id from pv)),
  'done:true', '다른 교시 칸이 더 최신이어도 그날 전체 칸에 연결된 채 완료다(행 순서와 무관)');
update public.attendance_records set status = 'absent', taught_by = mt.id(26) where id = mt.id(212);
select mt.eq(pg_temp.job((select id from pv)) || ':' || pg_temp.code((select id from pv)), 'done:ok', '시수 상태가 아닌 칸의 담당은 세지 않는다');
update public.attendance_records set status = 'present' where id = mt.id(212);
select mt.eq(pg_temp.job((select id from pv)) || ':' || pg_temp.held((select id from pv)), 'failed:attendance_observed:regular_teacher_differs',
  '완료 뒤에도 다른 칸의 담당이 달라지면 다시 붙잡는다');
update public.attendance_records set taught_by = null where id = mt.id(212);
select mt.eq(pg_temp.job((select id from pv)) || ':' || pg_temp.held((select id from pv)), 'done:none', '담당이 안 찍힌 칸은 종전처럼 그 반 담당으로 본다(회차 강사 = 그 반 담당)');

-- ⑧ 승인된 수기 시수도 다른 칸의 담당이 달라지면 다시 본다 · 이 모든 과정에서 출결 시수는 그대로다.
create temp table pw as select (mt.cmd(mt.id(22), 'reserve', pg_temp.bk(8, 25, '7')) ->> 'participant_id')::uuid as id;
select pg_temp.att(221, 8, 'present', 25, null, 3);
select mt.eq(mt.cmd(mt.id(25), 'participation', pg_temp.part((select id from pw), 221)) -> 'verification' ->> 'code', 'units_mismatch', '수기 시수(3) ≠ 예상(1.5) → 시수 차이(종전)');
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', r.id, 'reason', '수기 시수 확인', 'accept_manual_units', true), r.revision)
  from public.makeup_reconciliation r where r.participant_id = (select id from pw) and r.kind = 'units_mismatch';
select mt.eq(pg_temp.code((select id from pw)) || ':' || pg_temp.job((select id from pw)), 'accepted_manual_units:done', '수기 시수 승인은 종전처럼 된다');
select pg_temp.att(222, 8, 'present', 26, (select s from t4));
select mt.eq(pg_temp.code((select id from pw)) || ':' || pg_temp.job((select id from pw)), 'regular_teacher_differs:failed', '옛 승인은 뒤에 생긴 다른 담당의 칸을 덮지 못한다');
select mt.eq((select string_agg(coalesce(session_units::text, '-'), ',' order by id) from public.attendance_records
               where id in (mt.id(211), mt.id(212), mt.id(221), mt.id(222))), '1.5,-,3.0,-', '예약·참여·검증·승인 어느 것도 출결 시수를 쓰지 않는다');
select count(*) as passed from mt.passed;
rollback;
