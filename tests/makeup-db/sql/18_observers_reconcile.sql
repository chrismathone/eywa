-- 관측의 빈틈 메우기: 출결 UPDATE · 실패 연결 · 인계 · 대사 실행 (보완 8 — MU-007·008·024·034·053 · MU-X16·X17)
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 240) as b1,
  mt.approved_case(mt.id(63), mt.id(51), mt.d(-13), 120) as c1, mt.approved_case(mt.id(64), mt.id(52), mt.d(-12), 120) as d1,
  mt.approved_case(mt.id(62), mt.id(51), mt.d(-20), 240) as e1;
create function pg_temp.job(p uuid) returns text language sql as $$ select state from public.makeup_projection_jobs where effect_key = 'att:' || p $$;
create function pg_temp.total(p_actor uuid) returns integer language sql as $$ select (mt.run(p_actor, 'select public.makeup_list_cases()') ->> 'total')::int $$;
create function pg_temp.handover(p_case uuid) returns text language sql as $$
  select r.state || ':' || r.blocks_close || ':' || (select string_agg(x, ',' order by x) from jsonb_array_elements_text(r.detail -> 'reasons') x)
    from public.makeup_reconciliation r where r.dedupe_key = 'handover:' || p_case $$;
create function pg_temp.recs(p_actor uuid) returns jsonb language sql as $$ select mt.run(p_actor, 'select public.makeup_list_reconciliation()') $$;

-- ① 이미 있는 출결 행을 고치는 저장(UPDATE)도 관측한다: 상태를 결석으로 바꾸면 실패 + 대사, 되돌리면 닫힌다.
create temp table pa as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(301), mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'makeup', 1, mt.id(25));
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pa), 'status', 'present', 'actual_minutes', 110, 'attendance_record_id', mt.id(301)));
select mt.eq(pg_temp.job((select id from pa)), 'done', '맞는 출결(비정규일 보강 1.0)과 참여 → done');
update public.attendance_records set status = 'absent', session_units = null where id = mt.id(301);
select mt.eq(pg_temp.job((select id from pa)) || ':' || (select detail ->> 'code' from public.makeup_reconciliation where kind = 'attendance_observed' and participant_id = (select id from pa) and state = 'open'),
  'failed:attendance_not_countable', 'MU-X17 출결 상태 UPDATE 관측 → 왔다로 기록했는데 결석 = 실패 + 대사');
select mt.eq((select status::text || ':' || coalesce(session_units::text, '-') from public.attendance_records where id = mt.id(301)), 'absent:-', 'MU-034 정규 출결 저장은 그대로 성공(되돌리지 않는다)');
update public.attendance_records set status = 'makeup', session_units = 1 where id = mt.id(301);
select mt.eq(pg_temp.job((select id from pa)) || ':' || (select state from public.makeup_reconciliation where kind = 'attendance_observed' and participant_id = (select id from pa)), 'done:resolved', '다시 정정(UPDATE) → 닫힘');

-- ② 관측이 안에서 실패해도 저장은 성공하고, 실패는 닿는 참여·케이스 전부에 묶여 숨지 않는다.
create temp table pb as select mt.reserved(mt.id(22), mt.id(62), (select b1 from k), mt.d(0), array['3','4'], 110) as id;
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from pb), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성 지도 내용'));
alter table public.makeup_projection_jobs rename column last_error to last_error_broken;
update public.attendance_records set note = '합성 메모' where id = mt.id(301);
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(302), mt.id(11), mt.id(51), mt.id(62), mt.d(0), 'present', 1.5, mt.id(25));
alter table public.makeup_projection_jobs rename column last_error_broken to last_error;
select mt.eq((select count(*)::int from public.attendance_records where id = mt.id(302)), 1, 'MU-X16 관측 실패에도 출결 저장 성공');
select mt.eq((select count(*)::int from public.makeup_projection_jobs where effect_key like 'att-observe-failed:%'), 0, '실패 기록 표 자체가 깨지면 기록도 못 남긴다 — 그래서 대사 실행이 다시 본다(④)');
alter table public.makeup_reconciliation rename column dedupe_key to dedupe_key_broken;
update public.attendance_records set session_units = 1.5, note = '다시 저장' where id = mt.id(302);
alter table public.makeup_reconciliation rename column dedupe_key_broken to dedupe_key;
select mt.eq((select state || ':' || (participant_ids = array[(select id from pb)]) || ':' || (case_ids = array[(select b1 from k)]) from public.makeup_projection_jobs where effect_key = 'att-observe-failed:' || mt.id(302)),
  'failed:true:true', 'MU-X16 실패 작업에 그 학생·그날의 참여와 케이스를 적는다');
select mt.eq((makeup_private.close_blockers(mt.id(11), (select b1 from k)) ->> 'projections')::int, 1, '케이스에 직접 묶이지 않은 실패 작업도 그 케이스의 종결을 막는다');
select mt.ok('recon_open' = any (array(select jsonb_array_elements_text(r -> 'flags') from jsonb_array_elements(mt.run(mt.id(22), 'select public.makeup_list_cases()') -> 'rows') r where (r ->> 'id')::uuid = (select b1 from k))),
  '목록의 주의 표시에 잡힌다');
select mt.eq((pg_temp.recs(mt.id(25)) ->> 'projection_failed')::int, 1, '담당 강사의 대사 목록에도 보인다(범위 = 닿는 참여·케이스)');
select mt.eq((pg_temp.recs(mt.id(26)) ->> 'projection_total')::int, 0, '범위 밖 강사에게는 보이지 않는다');

-- ③ 인계: 담임 변경 · 수강 종료 · 퇴원 · 종강 뒤에도 열린 보강은 보존되고 인계 항목이 열린다. 권한은 지금 담당 기준.
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select c1 from k), 'owner_id', mt.id(25)), mt.rev('makeup_cases', (select c1 from k)));
select mt.eq(pg_temp.total(mt.id(25)) || ':' || pg_temp.total(mt.id(26)), '4:1', '바뀌기 전: 강사가 4건(반1) · 강사나 1건(반2)');
update public.classes set teacher_id = mt.id(26) where id = mt.id(51);
select mt.eq((select teacher_id from public.classes where id = mt.id(51)), mt.id(26), 'MU-008 담임 변경 저장은 막히지 않는다');
select mt.eq(pg_temp.total(mt.id(25)) || ':' || pg_temp.total(mt.id(26)), '3:5', 'MU-024 권한 재검증: 옛 담임은 회차 강사(2)·담당자(1)로 남은 건만, 새 담임은 전부(5)');
select mt.eq(pg_temp.handover((select c1 from k)), 'open:false:owner_out_of_scope', '담당자가 그 반을 더는 맡지 않는다 → 인계 항목(종결은 막지 않는다)');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'handover_review'), 1, '담당자가 없는 건은 인계 대상이 아니다(미배정 표시가 따로 있다)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(25), format('select public.makeup_case_detail(%L)', (select e1 from k))), 'not_found', '옛 담임에게 범위 밖 건은 없는 건이다');
select mt.cmd_throws(mt.id(25), 'hold', jsonb_build_object('case_id', (select e1 from k), 'reason', '합성', 'hold_review_at', mt.d(7)), mt.rev('makeup_cases', (select e1 from k)), 'forbidden', '옛 담임은 범위 밖 건을 바꾸지 못한다');
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select c1 from k), 'owner_id', mt.id(26)), mt.rev('makeup_cases', (select c1 from k)));
select mt.eq(pg_temp.handover((select c1 from k)), 'resolved:false:owner_out_of_scope', '새 담당 지정 → 인계 항목이 스스로 닫힌다');
update public.enrollments set end_date = mt.d(-1) where student_id = mt.id(62) and class_id = mt.id(51);
update public.students set status = 'withdrawn' where id = mt.id(63);
update public.classes set closed_at = mt.d(-1) where id = mt.id(52);
select mt.eq(pg_temp.handover((select b1 from k)) || ' / ' || pg_temp.handover((select c1 from k)) || ' / ' || pg_temp.handover((select d1 from k)),
  'open:false:enrollment_ended / open:false:student_withdrawn / open:false:class_closed', 'MU-007·008 수강 종료 · 퇴원 · 종강 → 각각 인계 항목');
select mt.eq((select string_agg(lifecycle || '/' || outstanding_minutes, ',' order by student_id) from public.makeup_cases), 'open/240,open/240,open/240,open/120,open/120', 'MU-008 열린 보강은 그대로 보존(자동 취소·소멸·종결 없음)');
select mt.eq((select status || ':' || actual_minutes from public.makeup_participants where id = (select id from pb)), 'present:110', '기록해 둔 참여도 그대로');
update public.students set status = 'enrolled' where id = mt.id(63);
select mt.eq(pg_temp.handover((select c1 from k)), 'resolved:false:student_withdrawn', '사유가 사라지면(재원 복귀) 인계 항목이 닫힌다');
select mt.eq((select string_agg(x ->> 'summary', '|') from jsonb_array_elements(pg_temp.recs(mt.id(22)) -> 'rows') x where x ->> 'kind' = 'handover_review' and (x ->> 'case_id')::uuid = (select d1 from k)),
  '담당이 바뀌었거나 수강이 끝난 학생의 보강이 남아 있습니다 — 담당자를 다시 정해 주세요', '대사 목록에 화면용 한 줄 요약이 실린다');

-- ④ 대사 실행: 트리거가 놓친 것(실패·날짜 경과·트리거 없는 변경)을 다시 본다. 탐지만 하고 아무것도 고치지 않는다.
alter table public.enrollments disable trigger enrollments_makeup_observe_handover;
update public.enrollments set end_date = mt.d(-1) where student_id = mt.id(61) and class_id = mt.id(51);
alter table public.enrollments enable trigger enrollments_makeup_observe_handover;
select mt.as_command();
update public.makeup_cases set committed_minutes = committed_minutes + 30 where id = (select c1 from k);
select mt.end_command();
create temp table before as select md5(string_agg(to_jsonb(ar)::text, '|' order by ar.id)) as att, (select committed_minutes from public.makeup_cases where id = (select c1 from k)) as c from public.attendance_records ar;
select mt.cmd_throws(mt.id(25), 'reconcile', '{"reason":"합성"}'::jsonb, null, 'forbidden', '대사 실행은 지점 전체 운영 권한만');
select mt.cmd_throws(mt.id(24), 'reconcile', '{}'::jsonb, null, 'invalid', '사유 없는 대사 실행 거절');
create temp table run1 as select mt.cmd(mt.id(24), 'reconcile', '{"reason":"합성 대사"}'::jsonb) -> 'run' as r;
select mt.eq((select (r ->> 'status') || ':' || (r ->> 'trigger') || ':' || ((r ->> 'checked')::int > 0) || ':' || ((r ->> 'opened')::int >= 3) from run1), 'succeeded:manual:true:true', '대사 실행 기록(성공·수동·검사 수·새로 열린 수)');
select mt.eq(pg_temp.job((select id from pb)) || ':' || (select string_agg(detail ->> 'code', ',') from public.makeup_reconciliation where participant_id = (select id from pb) and state = 'open' and blocks_close),
  'failed:attendance_other_teacher', 'MU-X16 관측이 실패해 놓쳤던 출결(학생B)을 다시 본다 — 담임이 바뀐 반의 칸이라 귀속 불일치로 드러난다');
select mt.eq(pg_temp.handover((select a1 from k)), 'open:false:enrollment_ended', '트리거 없이 지난 수강 종료도 인계 항목으로 올라온다');
select mt.eq((select state || ':' || blocks_close || ':' || (detail -> 'cached' ->> 'committed') || '≠' || (detail -> 'computed' ->> 'committed') from public.makeup_reconciliation where dedupe_key = 'quantity_drift:' || (select c1 from k)),
  'open:true:30≠0', '수량 어긋남(저장값 30 ≠ 하위 기록 0) → 종결 차단 대사');
select mt.ok((select b.att = (select md5(string_agg(to_jsonb(ar)::text, '|' order by ar.id)) from public.attendance_records ar)
  and b.c = (select committed_minutes from public.makeup_cases where id = (select c1 from k)) from before b), 'MU-034 대사 실행은 출결·시수·수량을 고치지 않는다(탐지만)');
select mt.eq((pg_temp.recs(mt.id(22)) -> 'last_run' ->> 'status'), 'succeeded', '화면이 읽는 마지막 실행');
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', r.id, 'reason', '하위 기록으로 다시 계산'), r.revision) from public.makeup_reconciliation r where r.kind = 'quantity_drift';
select mt.eq((select committed_minutes from public.makeup_cases where id = (select c1 from k)), 0, '수량 대사를 닫으면 하위 기록에서 다시 계산해 맞춘다');
-- 스캔이 실패하면 실패 기록이 남는다(조용한 0건이 아니다). 주기 실행은 service_role만 · 켜진 지점만.
alter table public.makeup_cases rename column adjusted_minutes to adjusted_minutes_broken;
select mt.eq(mt.cmd(mt.id(24), 'reconcile', '{"reason":"합성 실패"}'::jsonb) -> 'run' ->> 'status', 'failed', 'MU-053 스캔 실패 → 명령은 실패 기록을 남기고 끝난다');
alter table public.makeup_cases rename column adjusted_minutes_broken to adjusted_minutes;
select mt.ok((select (pg_temp.recs(mt.id(22)) -> 'last_run' ->> 'status') = 'failed' and (pg_temp.recs(mt.id(22)) -> 'last_run' ->> 'error') is not null), 'MU-053 마지막 실행이 실패였음을 목록이 그대로 말한다(미처리 원장은 그대로)');
select mt.ok((pg_temp.recs(mt.id(25)) -> 'last_run') = 'null'::jsonb, '실행 기록은 지점 전체 읽기 권한에만');
set local role service_role;
create temp table sched as select public.makeup_reconcile_tenants() as r;
reset role;
select mt.eq((select (r ->> 'tenants') || ':' || (r -> 'runs' -> 0 -> 'run' ->> 'status') || ':' || (r -> 'runs' -> 0 -> 'run' ->> 'trigger') from sched), '1:succeeded:scheduled', '주기 실행: 켜진 지점 1곳만 돌고 기록한다');
select mt.eq((select count(*)::int || ':' || count(*) filter (where started_by is null) from public.makeup_reconciliation_runs), '3:1', '실행 기록 3건(수동 2 · 주기 1 — 주기는 행위자 없음)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(21), 'select public.makeup_reconcile_tenants()'), '42501', '로그인 사용자는 주기 실행 함수를 부를 수 없다');
select count(*) as passed from mt.passed;
rollback;
