-- 화면용 읽기 RPC: 선택지(makeup_options) · 미연결 근거(makeup_candidates) — 범위·페이지·형태
begin;
select mt.seed_on();
select mt.login(null);
create function pg_temp.opt(p_actor uuid, p_filter jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_options(%L::jsonb)', p_filter)) $$;
create function pg_temp.cand(p_actor uuid, p_filter jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_candidates(%L::jsonb)', p_filter)) $$;

-- 선택지: 형태(id·name) · 과목·범위 필터 · 페이지.
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"students","subject_key":"math"}') ->> 'total')::int, 5, '수학 반 재원 학생 5명');
select mt.ok((select bool_and(r ? 'id' and r ? 'name') from jsonb_array_elements(pg_temp.opt(mt.id(22), '{"kind":"students"}') -> 'rows') r), '선택지 행은 id·name');
select mt.eq((pg_temp.opt(mt.id(25), '{"kind":"students","subject_key":"math"}') ->> 'total')::int, 3, '강사는 지금 담당 반의 학생만');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"students","q":"학생A"}') -> 'rows' -> 0 ->> 'name'), '가상학생A', '이름 검색');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"students","page_size":2,"page":3}') -> 'rows' -> 0 ->> 'name'), '가상학생E', '선택지 페이지(3쪽 첫 행)');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"classes","subject_key":"math"}') ->> 'total')::int, 2, '수학 반 2개');
select mt.eq((pg_temp.opt(mt.id(25), '{"kind":"classes","subject_key":"math"}') -> 'rows' -> 0 ->> 'name'), '수학 가반', '강사는 지금 담당 반');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"staff"}') ->> 'total')::int, 8, '재직 직원만(비활성·학생 계정 제외)');
select mt.eq((select string_agg(r ->> 'name', ',') from jsonb_array_elements(pg_temp.opt(mt.id(25), '{"kind":"staff"}') -> 'rows') r), '강사가', '강사 범위는 직원 명단을 받지 않는다 — 본인만');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"students","page_size":2,"page":9}') ->> 'total') || ':' || jsonb_array_length(pg_temp.opt(mt.id(22), '{"kind":"students","page_size":2,"page":9}') -> 'rows'), '5:0',
  '끝을 넘긴 쪽도 전체 수는 그대로(세는 것은 DB)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(24), 'select public.makeup_options(''{"kind":"policies"}'')'), 'forbidden', '정책 선택지는 승인 권한자만(매니저 거절)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(25), 'select public.makeup_options(''{"kind":"policies"}'')'), 'forbidden', '정책 선택지 — 강사 거절');
select mt.ok((pg_temp.opt(mt.id(22), '{"kind":"policies"}') ->> 'total')::int >= 0, '정책 선택지 — 관리자는 읽는다');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"classrooms","q":"3강의실"}') -> 'rows' -> 0 ->> 'name'), '가상 3강의실 (정원 미설정)', '강의실은 정원을 함께 적는다');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_options(''{"kind":"nope"}'')'), 'invalid', '알 수 없는 선택지 종류 거절');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(28), 'select public.makeup_options(''{"kind":"staff"}'')'), 'forbidden', '권한 없는 계정은 선택지도 거절');

-- 출결·보고서 선택지: 그 학생의 유효 행만, 한글 상태 표기. 담당하지 않는 학생은 거절.
insert into public.attendance_records (id, tenant_id, class_id, student_id, session_date, status, session_units, recorded_by, recorded_at)
  values (mt.id(81), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'present', 1, mt.id(25), now() - interval '2 hours'),
         (mt.id(82), mt.id(11), mt.id(51), mt.id(61), mt.d(-6), 'absent', null, mt.id(25), now() - interval '1 hour'),
         (mt.id(83), mt.id(11), mt.id(51), mt.id(62), mt.d(-6), 'absent', null, mt.id(25), now() - interval '1 hour'),
         (mt.id(84), mt.id(11), mt.id(51), mt.id(63), mt.d(-6), 'absent', null, mt.id(25), now() - interval '2 hours'),
         (mt.id(85), mt.id(11), mt.id(51), mt.id(63), mt.d(-6), 'late', 1, mt.id(25), now() - interval '1 hour'),
         (mt.id(86), mt.id(11), mt.id(52), mt.id(64), mt.d(-5), 'excused', null, mt.id(26), now() - interval '1 hour'),
         (mt.id(87), mt.id(11), mt.id(53), mt.id(61), mt.d(-6), 'absent', null, mt.id(26), now() - interval '1 hour'),
         (mt.id(88), mt.id(11), mt.id(51), mt.id(62), mt.d(-500), 'absent', null, mt.id(25), now() - interval '1 hour');
create temp table att as select pg_temp.opt(mt.id(25), jsonb_build_object('kind', 'attendance', 'student_id', mt.id(61), 'subject_key', 'math')) as r;
select mt.eq((select (r ->> 'total')::int from att), 1, '출결 선택지는 정정 이력을 접은 유효 행 1건');
select mt.eq((select (r -> 'rows' -> 0 ->> 'id')::uuid from att), mt.id(82), '유효 행 = 가장 나중에 찍힌 행');
select mt.ok((select r -> 'rows' -> 0 ->> 'name' like '%수학 가반 · 결석%' from att), '출결 상태는 한글로 표기(코드 노출 없음)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(26), format('select public.makeup_options(''{"kind":"attendance","student_id":"%s","subject_key":"math"}'')', mt.id(62))),
  'forbidden', '담당하지 않는 학생의 출결 선택지 거절');
insert into public.lesson_reports (id, tenant_id, student_id, report_date, subject, makeup, teacher_name) values (mt.id(95), mt.id(11), mt.id(61), mt.d(-1), 'math', true, '강사가');
select mt.ok((pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'reports', 'student_id', mt.id(61), 'subject_key', 'math')) -> 'rows' -> 0 ->> 'name') like '%반 없는 보고서 · 강사가 · 보강', '보고서 선택지 표기');
select mt.eq((pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'reports', 'student_id', mt.id(61), 'subject_key', 'math')) -> 'rows' -> 0 ->> 'linkable')::boolean, true, '보강 근거로 연결할 수 있는 모양인지 알려 준다');

-- 미연결 결석 후보: 유효 행이 결석인 날만(출석으로 정정된 날·그날 시수 상태가 있는 날 제외), 대상 과목만.
-- MU-049 숨은 기본 기간이 없다 — 500일 전 결석도 기본으로 나온다. 기간은 준 대로만 좁힌다.
create temp table ca as select pg_temp.cand(mt.id(22), '{"kind":"absence","date_from":"","date_to":""}') as r;
select mt.eq((select (r ->> 'total')::int from ca), 4, 'MU-049 결석 후보 4건(학생A·B·D + 500일 전 학생B) — 지각으로 정정된 학생C·영어 제외');
select mt.ok((select (select bool_and(x ?& array['id','student_id','student_name','class_id','class_name','subject_key','original_date','status'] and not x ? 'session_date')
  from jsonb_array_elements(r -> 'rows') x) from ca), '결석 후보 행의 키(예정 일정 칸은 싣지 않는다)');
select mt.ok((select r -> 'date_from' = 'null'::jsonb and r -> 'date_to' = 'null'::jsonb from ca), '기간을 주지 않으면 적용한 기간도 없다(전 기간)');
select mt.eq((pg_temp.cand(mt.id(22), jsonb_build_object('kind', 'absence', 'date_from', mt.d(-365))) ->> 'total')::int, 3, '시작일을 주면 그날부터');
select mt.eq((pg_temp.cand(mt.id(22), jsonb_build_object('kind', 'absence', 'date_to', mt.d(-400))) ->> 'total')::int, 1, '종료일을 주면 그날까지(오래된 결석만)');
select mt.eq((pg_temp.cand(mt.id(22), jsonb_build_object('kind', 'absence', 'page', 2, 'page_size', 3)) ->> 'total') || ':' ||
  jsonb_array_length(pg_temp.cand(mt.id(22), jsonb_build_object('kind', 'absence', 'page', 2, 'page_size', 3)) -> 'rows'), '4:1', '쪽 나눔: 전체 4건 · 둘째 쪽 1건');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_candidates(''{"date_from":"2026-13-99x"}'')'), 'invalid', '날짜가 아닌 기간 값은 전 기간으로 읽지 않고 거절');
select mt.eq((pg_temp.cand(mt.id(25), '{"kind":"absence"}') ->> 'total')::int, 3, '강사는 지금 담당 반의 결석만(반1: 학생A·B + 오래된 학생B)');
-- 후보를 그대로 접수하면(화면이 보내는 값) 후보에서 빠진다.
select mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'subject_key', 'math', 'original_class_id', mt.id(51),
  'original_date', mt.d(-6), 'reason', 'absence', 'source_kind', 'attendance', 'source_id', mt.id(82)));
select mt.eq((pg_temp.cand(mt.id(22), '{"kind":"absence"}') ->> 'total')::int, 3, '접수한 결석은 후보에서 빠진다');

-- 기존 예약 후보: 연결 안 된 예약만. 연결하면 빠지고, 결석 후보에도 다시 나오지 않는다.
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(101), mt.id(11), mt.id(62), mt.id(51), mt.d(-6), mt.d(3), '10:00', '11:00');
create temp table cl as select pg_temp.cand(mt.id(22), '{"kind":"legacy"}') as r;
select mt.eq((select (r -> 'rows' -> 0 ->> 'id')::uuid from cl), mt.id(101), '기존 예약 후보');
select mt.eq((select (r -> 'rows' -> 0 ->> 'session_date') || ':' || (r -> 'rows' -> 0 ->> 'status_label') from cl), mt.d(3)::text || ':예약', '기존 예약 후보의 예정 일정·상태 표기');
select mt.eq((pg_temp.cand(mt.id(22), '{"kind":"absence"}') ->> 'total')::int, 2, '예약이 잡힌 결석은 결석 후보가 아니라 기존 예약 후보');
select mt.eq((pg_temp.cand(mt.id(22), jsonb_build_object('kind', 'legacy', 'date_from', mt.d(-3))) ->> 'total')::int, 0, '기간 조건은 기존 예약 후보에도 같이 걸린다(원수업일 기준)');
select mt.cmd(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(101)));
select mt.eq((pg_temp.cand(mt.id(22), '{"kind":"legacy"}') ->> 'total')::int, 0, '연결한 예약은 후보에서 빠진다');
-- 합류할 회차 선택지: 확정 · 오늘 이후 · 가져온(강사 미정) 회차 제외.
create temp table k as select mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1;
select mt.reserved(mt.id(22), mt.id(64), (select d1 from k), mt.d(4), array['1','2'], 110);
create temp table so as select pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'sessions', 'subject_key', 'math', 'session_date', mt.d(4))) as r;
select mt.eq((select (r ->> 'total')::int from so), 1, '합류할 회차 선택지 1건(가져온 회차는 제외)');
select mt.ok((select r -> 'rows' -> 0 ->> 'name' like '%강사가 · 가상 1강의실 (1/4명)' from so), '회차 선택지 표기(강사·강의실·인원/정원)');
select mt.eq((pg_temp.opt(mt.id(26), jsonb_build_object('kind', 'sessions', 'subject_key', 'math')) ->> 'total')::int, 0, '강사는 본인이 맡은 회차만 고른다');
select count(*) as passed from mt.passed;
rollback;
