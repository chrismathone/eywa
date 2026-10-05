-- 정규 저장 쪽 계약: 막지 않고 영향 큐에 남긴다 · 직원 비활성/삭제 · 학원 삭제 (MU-007·008·024 · MU-X13 단일 연결 부분)
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1, mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 120) as a1;

-- 살아 있는 보강 회차가 없으면 정규 시간표 저장은 대사를 만들지 않는다(빠른 통과).
insert into public.class_schedules (tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
  values (mt.id(11), mt.id(53), mt.dow(mt.d(6)), '09:00', '10:00', mt.d(-10));
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'timetable_conflict'), 0, '보강 회차가 없으면 영향 큐도 없다');

-- 학생D의 보강: d(3) 1~2교시 · 강사1 · 1강의실.
create temp table p as select mt.reserved(mt.id(22), mt.id(64), (select d1 from k), mt.d(3), array['1','2'], 110) as id;
create temp table s as select ms.* from public.makeup_sessions ms where ms.id = (select session_id from public.makeup_participants where id = (select id from p));
-- ① 강사 충돌: 강사1의 정규 수업을 같은 시각 다른 강의실(2강의실)에 새로 넣는다 → 저장은 성공, 영향 큐에 남는다.
insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from, classroom_id)
  values (mt.id(75), mt.id(11), mt.id(51), mt.dow(mt.d(3)), (select start_time from s), (select end_time from s), mt.d(-10), mt.id(42));
select mt.eq((select count(*)::int from public.class_schedules where id = mt.id(75)), 1, 'MU-X13 정규 시간표 저장은 거절되지 않는다');
select mt.eq((select detail ->> 'type' from public.makeup_reconciliation where kind = 'timetable_conflict' and dedupe_key = 'tt:teacher:' || (select id from s)), 'teacher', 'MU-X13 강사 충돌이 영향 큐에 남는다');
-- ② 학생 충돌: 학생D의 반2를 그 시각에 넣는다.
insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from)
  values (mt.id(76), mt.id(11), mt.id(52), mt.dow(mt.d(3)), (select start_time from s), (select end_time from s), mt.d(-10));
select mt.eq((select detail ->> 'type' from public.makeup_reconciliation where dedupe_key = 'tt:student:' || (select id from p)), 'student', 'MU-X13 학생 시간 겹침이 영향 큐에 남는다');
-- ③ 강의실 정원: 1강의실(정원 4)에 반1을 그 시각으로 옮긴다(재원 3명 + 보강 1명 = 4 → 수강 1명 추가로 초과).
update public.class_schedules set classroom_id = mt.id(41) where id = mt.id(75);
select mt.eq((select count(*)::int from public.makeup_reconciliation where dedupe_key = 'tt:room:' || (select id from s)), 0, '정원 안이면 강의실 대사 없음');
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(65), mt.id(51), mt.d(-1));
select mt.eq((select (detail ->> 'regular') || '+' || (detail ->> 'makeup') || '>' || (detail ->> 'capacity') from public.makeup_reconciliation where dedupe_key = 'tt:room:' || (select id from s)), '4+1>4', 'MU-X13 수강 추가로 정원 초과 → 영향 큐');
select mt.eq((select state from public.makeup_sessions where id = (select id from s)), 'confirmed', '정규 변경이 보강 일정을 지우거나 바꾸지 않는다');
-- 영향 큐는 지점 전체 운영 권한이 확인·해결한다. 같은 충돌이 다시 저장돼도 줄이 늘지 않는다.
update public.class_schedules set period_label = '다시 저장' where id = mt.id(76);
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'timetable_conflict'), 3, '같은 충돌은 한 줄(중복 생성 없음)');
select mt.eq((mt.run(mt.id(24), 'select public.makeup_list_reconciliation(''{"kind":"timetable_conflict"}'')') ->> 'total')::int, 3, '매니저는 영향 큐를 본다');
select mt.eq((mt.run(mt.id(25), 'select public.makeup_list_reconciliation(''{"kind":"timetable_conflict"}'')') ->> 'total')::int, 3, '그 회차의 강사는 회차 단위 항목(강사·강의실 충돌)까지 본다 — 케이스에 직접 묶이지 않았다고 숨지 않는다');
select mt.eq((select count(*)::int from jsonb_array_elements(mt.run(mt.id(22), format('select public.makeup_case_detail(%L)', (select d1 from k))) -> 'reconciliation') r where r ->> 'kind' = 'timetable_conflict'), 3,
  '상세에도 회차 단위 항목 3건이 전부 보인다(1:N 연결)');
select mt.ok('recon_open' = any (array(select jsonb_array_elements_text(r -> 'flags') from jsonb_array_elements(mt.run(mt.id(22), 'select public.makeup_list_cases()') -> 'rows') r where (r ->> 'id')::uuid = (select d1 from k))),
  '목록의 주의 표시에도 회차 단위 항목이 잡힌다');
select mt.eq((mt.run(mt.id(31), 'select public.makeup_command(gen_random_uuid(), ''configure'', ''{"mode":"on"}'')') ->> 'action'), 'configure', '다른 지점도 켠다');
select mt.eq((mt.run(mt.id(31), 'select public.makeup_list_reconciliation(''{"state":"all"}'')') ->> 'total')::int, 0, '다른 지점에는 한 건도 보이지 않는다');
select mt.cmd(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from public.makeup_reconciliation where dedupe_key = 'tt:teacher:' || (select id from s)), 'note', '강의실 조정 완료'),
  (select revision from public.makeup_reconciliation where dedupe_key = 'tt:teacher:' || (select id from s)));
select mt.eq((select state from public.makeup_reconciliation where dedupe_key = 'tt:teacher:' || (select id from s)), 'resolved', '영향 큐 해결 기록');
-- 정규 시간표 삭제도 막지 않는다.
delete from public.class_schedules where id in (mt.id(75), mt.id(76));
select mt.eq((select count(*)::int from public.class_schedules where id in (mt.id(75), mt.id(76))), 0, '정규 시간표 삭제 성공');

-- MU-024 담당자·실시 강사가 재직이 아니게 되면 대체 배정 큐가 생기고, 그 계정의 권한은 즉시 풀린다.
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select a1 from k), 'owner_id', mt.id(25)), mt.rev('makeup_cases', (select a1 from k)));
update public.users set status = 'inactive' where id = mt.id(25);
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'owner_inactive' and case_id = (select a1 from k) and state = 'open'), 1, 'MU-024 담당자 부재 → 대체 배정 큐');
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'teacher_inactive' and session_id = (select id from s) and state = 'open'), 1, 'MU-024 실시 강사 부재 → 대체 배정 큐');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(25), 'select public.makeup_list_cases()'), 'forbidden', 'MU-024 비활성 계정은 즉시 접근 불가');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases()') ->> 'total')::int, 2, 'MU-024 미처리 건은 숨지 않는다');
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select a1 from k), 'owner_id', mt.id(26)), mt.rev('makeup_cases', (select a1 from k)));
select mt.eq((select state from public.makeup_reconciliation where kind = 'owner_inactive' and case_id = (select a1 from k)), 'resolved', 'MU-024 새 담당 지정 → 담당 부재 대사 해소');
select mt.ok(exists (select 1 from public.makeup_events where event_type = 'assigned' and data ->> 'previous_owner_id' = mt.id(25)::text), 'MU-007 이전 담당자는 이력에 남는다');
-- 강사2로 일정 변경(대체 배정) — 2강의실.
select mt.cmd(mt.id(22), 'reschedule', jsonb_build_object('session_id', (select id from s), 'session_date', mt.d(4), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(26), 'classroom_id', mt.id(42), 'reason', '대체 강사 배정'), mt.rev('makeup_sessions', (select id from s)));
select mt.eq((select teacher_id from public.makeup_sessions where state = 'confirmed'), mt.id(26), 'MU-024 대체 강사로 새 회차');

-- 직원 삭제는 원장이 막지 않는다(연결 칸만 비고 기록은 남는다). 학생·반 삭제는 원장이 남아 있으면 거절.
delete from public.users where id = mt.id(22);
select mt.eq((select count(*)::int from public.users where id = mt.id(22)), 0, '직원 삭제는 원장 때문에 거절되지 않는다');
select mt.ok((select count(*) > 0 and bool_and(actor_id is null) from public.makeup_events where event_type = 'approved'), '삭제된 직원의 이벤트는 남고 행위자 칸만 빈다');
select mt.eq((select count(*)::int from public.makeup_cases), 2, '직원 삭제로 케이스가 사라지지 않는다');
select mt.throws('delete from public.students where id = mt.id(64)', 'P0001', 'MU-008 연결된 예약이 있는 학생 삭제 거절(연쇄 소멸 없음)');
select mt.throws('delete from public.students where id = mt.id(61)', '23503', 'MU-008 보강 건이 있는 학생 삭제 거절(FK)');
-- 학원(지점) 자체 삭제의 연쇄는 통과한다.
select mt.cmd(mt.id(31), 'intake', jsonb_build_object('student_id', mt.id(69), 'original_class_id', mt.id(59), 'original_date', mt.d(-3)));
delete from public.tenants where id = mt.id(12);
select mt.eq((select count(*)::int from public.makeup_cases where tenant_id = mt.id(12)) + (select count(*)::int from public.makeup_events where tenant_id = mt.id(12)), 0, '학원 삭제 연쇄는 통과');
select count(*) as passed from mt.passed;
rollback;
