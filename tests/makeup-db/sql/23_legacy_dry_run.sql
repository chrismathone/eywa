-- 기존 예약 가져오기 미리 보기(운영 쓰기 0) · 미리 본 뒤 바뀐 예약의 연결 거절 (MU-054·055·056·074)
begin;
select mt.seed_on();
select mt.login(null);
-- 등급 E용 합성: 폐지 반 · 퇴원 학생 · 수강이 끝난 학생.
insert into public.classes (id, tenant_id, class_name, subject, teacher_id, classroom_id, is_active) values (mt.id(54), mt.id(11), '수학 폐지반', 'math', mt.id(26), mt.id(42), false);
insert into public.students (id, tenant_id, name, status) values (mt.id(66), mt.id(11), '가상학생F', 'withdrawn'), (mt.id(67), mt.id(11), '가상학생G', 'enrolled'), (mt.id(68), mt.id(11), '가상학생H', 'enrolled');
insert into public.enrollments (tenant_id, student_id, class_id, start_date, end_date) values
  (mt.id(11), mt.id(66), mt.id(51), mt.d(-200), null), (mt.id(11), mt.id(67), mt.id(51), mt.d(-200), mt.d(-1)), (mt.id(11), mt.id(68), mt.id(54), mt.d(-200), null);
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, recorded_at) values
  (mt.id(301), mt.id(11), mt.id(51), mt.id(62), mt.d(-1), 'makeup', 1, mt.id(25), now() - interval '2 hours'),
  (mt.id(302), mt.id(11), mt.id(52), mt.id(65), mt.d(-1), 'makeup', 1, mt.id(26), now() - interval '2 hours'),
  (mt.id(303), mt.id(11), mt.id(52), mt.id(65), mt.d(-1), 'absent', null, mt.id(26), now() - interval '1 hour'),
  (mt.id(304), mt.id(11), mt.id(51), mt.id(62), mt.d(-5), 'makeup', 1, mt.id(25), now() - interval '2 hours');
insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, makeup, makeup_class_id, created_by) values
  (mt.id(501), mt.id(11), mt.id(63), mt.d(-3), 'math', true, mt.id(51), mt.id(25)), (mt.id(502), mt.id(11), mt.id(62), mt.d(-5), 'math', true, mt.id(51), mt.id(25));
select mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51), 'original_date', mt.d(-13)));
create function pg_temp.resv(p_id integer, p_student integer, p_class integer, p_absence date, p_makeup date, p_status text default 'reserved',
  p_att uuid default null, p_note text default null, p_slot time default '10:00') returns void language sql as $$
  insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, status, done_at, attendance_record_id, note)
    values (mt.id(p_id), mt.id(11), mt.id(p_student), mt.id(p_class), p_absence, p_makeup, p_slot, p_slot + interval '1 hour', p_status,
      case when p_status = 'done' then now() end, p_att, p_note) $$;
select pg_temp.resv(101, 61, 51, mt.d(-6), mt.d(3));                                        -- A 아직 오지 않은 예약
select pg_temp.resv(115, 62, 51, mt.d(-27), mt.d(-5), 'done', mt.id(304));                  -- B 이행 + 유효 출결 + 유효 보강 보고서
select pg_temp.resv(102, 62, 51, mt.d(-6), mt.d(-1), 'done', mt.id(301));                   -- C 이행 + 출결만(보고서 없음)
select pg_temp.resv(103, 63, 51, mt.d(-6), mt.d(-3), 'done');                               -- C 이행 + 보고서만(출결 연결 없음)
select pg_temp.resv(104, 63, 51, mt.d(-20), mt.d(-2));                                      -- C 보강일이 지났는데 이행 없음
select pg_temp.resv(105, 62, 51, mt.d(-20), mt.d(-4), 'done');                              -- C 이행인데 근거 없음
select pg_temp.resv(106, 65, 52, mt.d(-12), mt.d(-1), 'done', mt.id(302));                  -- C 연결된 출결이 정정으로 덮임
select pg_temp.resv(107, 65, 52, mt.d(-19), mt.d(5), 'reserved', null, '학부모 요청으로 취소 예정'); -- C 메모의 취소 표현
select pg_temp.resv(108, 64, 52, mt.d(-5), mt.d(3));                                        -- D 같은 원수업을 둘로 나눠 잡음
select pg_temp.resv(109, 64, 52, mt.d(-5), mt.d(4));
select pg_temp.resv(110, 61, 51, mt.d(-13), mt.d(4));                                       -- D 그 원수업의 건이 이미 있다
select pg_temp.resv(111, 66, 51, mt.d(-6), mt.d(3));                                        -- E 퇴원 학생
select pg_temp.resv(112, 67, 51, mt.d(-6), mt.d(3));                                        -- E 수강 종료
select pg_temp.resv(113, 68, 54, mt.d(-6), mt.d(3));                                        -- E 폐지 반
select pg_temp.resv(114, 61, 53, mt.d(-6), mt.d(6));                                        -- (영어 — 대상 과목 아님)
create function pg_temp.dry(p_actor uuid, p jsonb default '{}') returns jsonb language sql as $$ select mt.run(p_actor, format('select public.makeup_legacy_dry_run(%L::jsonb)', p)) $$;
create function pg_temp.grade(p jsonb, p_id integer) returns text language sql as $$
  select (x ->> 'evidence_grade') || ':' || (x ->> 'duplicate_count') from jsonb_array_elements(p -> 'rows') x where (x ->> 'id')::uuid = mt.id(p_id) $$;
create temp table snap as select
  (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.makeup_reservations r) as resv,
  (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.attendance_records r) as att,
  (select count(*) from public.makeup_cases) as cases, (select count(*) from public.makeup_legacy_maps) as maps,
  (select count(*) from public.makeup_events) as events, (select count(*) from public.makeup_reconciliation) as recon,
  (select count(*) from public.makeup_projection_jobs) as jobs, (select count(*) from public.makeup_case_sources) as sources;

-- ① 등급: 하나만 붙고 우선순위는 E → D → B / A / C. B는 출결과 보고서가 **둘 다** 확인될 때만이다(세부 조건은 24번).
create temp table d as select pg_temp.dry(mt.id(22)) as r;
select mt.eq((select (r ->> 'total') || ':' || (r -> 'counts')::text || ':' || (r ->> 'writes') from d), '14:{"A": 1, "B": 1, "C": 6, "D": 3, "E": 3}:0', 'MU-054 14건 · 등급별 수(합 = 전체) · 쓰기 0 — 영어 예약은 대상이 아니다');
select mt.eq((select pg_temp.grade(r, 101) || ' ' || pg_temp.grade(r, 115) || ' ' || pg_temp.grade(r, 102) || ' ' || pg_temp.grade(r, 103) from d), 'A:0 B:0 C:0 C:0',
  'A 오지 않은 예약 · B 이행 + 출결 + 보고서 · C 출결만 · C 보고서만');
select mt.eq((select pg_temp.grade(r, 104) || ' ' || pg_temp.grade(r, 105) || ' ' || pg_temp.grade(r, 106) || ' ' || pg_temp.grade(r, 107) from d), 'C:0 C:0 C:0 C:0',
  'MU-056 C: 지난 예약 · 근거 없는 이행 · 정정으로 덮인 출결 · 메모의 취소 표현(B·A로 올리지 않는다)');
select mt.eq((select pg_temp.grade(r, 108) || ' ' || pg_temp.grade(r, 109) || ' ' || pg_temp.grade(r, 110) from d), 'D:1 D:1 D:0', 'D: 같은 원수업의 예약 둘(서로 1건씩) · 원장에 이미 있는 원사건');
select mt.eq((select pg_temp.grade(r, 111) || ' ' || pg_temp.grade(r, 112) || ' ' || pg_temp.grade(r, 113) from d), 'E:0 E:0 E:0', 'E: 퇴원 학생 · 수강 종료 · 폐지 반');
select mt.ok((select bool_and(x ?& array['id','student_id','student_name','class_id','class_name','subject_key','original_date','session_date','status','status_label',
  'source_hash','occurrence_key','evidence_grade','duplicate_count','review_note'] and length(x ->> 'review_note') > 0) from d, jsonb_array_elements(r -> 'rows') x), '행의 키 · review_note는 항상 글');
select mt.eq((select (x ->> 'source_hash') || '|' || (x ->> 'occurrence_key') from d, jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = mt.id(101)),
  (select md5((to_jsonb(r) - 'updated_at')::text) || '|day:' || mt.id(61) || ':' || mt.id(51) || ':' || to_char(mt.d(-6), 'YYYY-MM-DD') from public.makeup_reservations r where r.id = mt.id(101)),
  'source_hash = 예약 행(updated_at 제외)의 md5 · occurrence_key = day:학생:원반:원수업일');
select mt.ok((select x ->> 'review_note' like '%확인하지 못했습니다%' from d, jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = mt.id(106)), '확인하지 못한 이행은 까닭을 적는다');
-- ② 범위·권한·꺼짐은 미연결 근거 목록과 같다.
select mt.eq((pg_temp.dry(mt.id(25)) ->> 'total') || ':' || (pg_temp.dry(mt.id(26)) ->> 'total'), '9:5', '강사는 지금 담당 반의 예약만(반1 9건 · 반2와 폐지반 5건)');
select mt.eq((pg_temp.dry(mt.id(22), jsonb_build_object('q', '학생B', 'date_from', mt.d(-10))) ->> 'total')::int, 1, '이름·기간 조건이 같이 걸린다');
select mt.throws(format('select pg_temp.dry(%L::uuid)', mt.id(28)), 'forbidden', '권한 없는 계정 거절');
select mt.throws(format('select pg_temp.dry(%L::uuid)', mt.id(31)), 'mode_off', '꺼진 지점은 예외(빈 목록이 아니다)');
select mt.ok(not has_function_privilege('anon', 'public.makeup_legacy_dry_run(jsonb)', 'execute') and not has_function_privilege('service_role', 'public.makeup_legacy_dry_run(jsonb)', 'execute')
  and (select provolatile = 's' from pg_proc where oid = 'public.makeup_legacy_dry_run(jsonb)'::regprocedure), '로그인 사용자 전용 · STABLE 함수(쓰기 문장을 실행할 수 없다)');
-- ③ 아무것도 쓰지 않았다: 예약·출결·시수·원장 행 수가 그대로다.
select mt.ok((select s.resv = (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.makeup_reservations r)
  and s.att = (select md5(string_agg(to_jsonb(r)::text, '|' order by r.id)) from public.attendance_records r)
  and (s.cases, s.maps, s.events, s.recon, s.jobs, s.sources) = ((select count(*) from public.makeup_cases), (select count(*) from public.makeup_legacy_maps),
    (select count(*) from public.makeup_events), (select count(*) from public.makeup_reconciliation), (select count(*) from public.makeup_projection_jobs), (select count(*) from public.makeup_case_sources)) from snap s),
  'MU-054 미리 보기는 운영 쓰기 0 — 예약·출결(시수)·원장 표가 한 줄도 바뀌지 않았다');

-- ④ 미리 본 뒤 예약이 바뀌면 연결을 거절한다(쓰기 전에). 지금 내용의 해시로는 연결된다.
create temp table h as select (x ->> 'source_hash') as old from d, jsonb_array_elements(r -> 'rows') x where (x ->> 'id')::uuid = mt.id(101);
update public.makeup_reservations set note = '시간 변경 요청' where id = mt.id(101);
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(101), 'expected_source_hash', (select old from h)), null, 'conflict', 'MU-074 미리 본 뒤 바뀐 예약은 옛 해시로 연결되지 않는다');
select mt.eq((select count(*)::int from public.makeup_legacy_maps) + (select count(*)::int from public.makeup_case_sources where source_kind = 'reservation'), 0, '거절된 연결은 아무것도 쓰지 않았다(연결·근거 0줄)');
create temp table h2 as select (x ->> 'source_hash') as now, (x ->> 'evidence_grade') as g from jsonb_array_elements(pg_temp.dry(mt.id(22), '{"q":"학생A"}') -> 'rows') x where (x ->> 'id')::uuid = mt.id(101);
select mt.ok((select now <> (select old from h) and g = 'C' from h2), '다시 본 미리 보기는 새 해시를 주고, 메모의 변경 표현 때문에 등급도 C로 바뀐다');
select mt.eq(mt.cmd(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(101), 'expected_source_hash', (select now from h2), 'batch_id', gen_random_uuid())) ->> 'existing', 'false', '지금 내용의 해시로는 연결된다');
select mt.eq((select checksum from public.makeup_legacy_maps where legacy_id = mt.id(101)), (select now from h2), 'MU-055 연결이 찍은 체크섬 = 미리 보기의 source_hash');
select mt.eq((pg_temp.dry(mt.id(22)) ->> 'total')::int, 13, '연결한 예약은 미리 보기에서 빠진다');

-- ⑤ 1,000건이 넘어도 전부 넘겨 읽는다: 전체 수·등급별 수가 맞고 쪽을 이으면 빠짐·겹침이 없다.
insert into public.students (id, tenant_id, name) select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, mt.id(11), '대량학생' || lpad(n::text, 4, '0') from generate_series(1, 1001) n;
insert into public.makeup_reservations (tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  select mt.id(11), ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, mt.id(51), mt.d(-30), mt.d(5), '10:00', '11:00' from generate_series(1, 1001) n;
create temp table pages as select n, pg_temp.dry(mt.id(22), jsonb_build_object('q', '대량학생', 'page', n, 'page_size', 200)) as r from generate_series(1, 7) n;
select mt.eq((select string_agg(jsonb_array_length(r -> 'rows')::text, ',' order by n) from pages), '200,200,200,200,200,1,0', 'MU-054 1,001건 = 200건씩 여섯 쪽(마지막 1건) · 끝을 넘긴 쪽은 빈 쪽');
select mt.eq((select count(distinct x ->> 'id') || ':' || count(*) from pages, jsonb_array_elements(r -> 'rows') x), '1001:1001', '쪽을 이으면 1,001건 전부(겹침 없음)');
select mt.ok((select bool_and((r ->> 'total')::int = 1001 and (r -> 'counts' ->> 'E')::int = 1001 and (r ->> 'writes')::int = 0) from pages), '매 쪽이 전체 수와 등급별 수를 말한다(수강 없는 학생이라 전부 E)');
select mt.eq((pg_temp.dry(mt.id(22), '{"page_size":9999}') ->> 'page_size')::int, 200, '한 쪽의 상한은 200');
select count(*) as passed from mt.passed;
rollback;
