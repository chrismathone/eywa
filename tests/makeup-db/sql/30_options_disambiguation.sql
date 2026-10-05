-- 선택지(0350c): 동명이인을 가르는 단서(학교·학년·반) · 원수업 반 후보(purpose=original — 지금은 종료된 반 포함) · 옛 호출 그대로
begin;
select mt.seed_on();
select mt.login(null);
create function pg_temp.opt(p_actor uuid, p_filter jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_options(%L::jsonb)', p_filter)) $$;
create function pg_temp.names(p jsonb) returns text language sql as $$
  select coalesce(string_agg(r ->> 'name', ',' order by r ->> 'name'), '') from jsonb_array_elements(p -> 'rows') r $$;
create function pg_temp.row_of(p jsonb, p_id uuid) returns jsonb language sql as $$
  select r from jsonb_array_elements(p -> 'rows') r where (r ->> 'id')::uuid = p_id $$;

-- 이름이 같은 두 학생: 가상학생A(수학 가반 · 영어 가반)와 새 가상학생A(수학 나반). 학교·학년이 다르다.
update public.students set school = '가상초등학교', grade = '초6' where id = mt.id(61);
insert into public.students (id, tenant_id, name, school, grade) values (mt.id(66), mt.id(11), '가상학생A', '모의중학교', '중1');
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(66), mt.id(52), mt.d(-30));

-- ① 같은 이름 두 줄이 서로 다른 단서를 갖는다. 이름(name)은 그대로다.
create temp table two as select pg_temp.opt(mt.id(22), '{"kind":"students","subject_key":"math","q":"가상학생A"}') as r;
select mt.eq((select (r ->> 'total')::int from two), 2, '이름이 같은 학생 두 명');
select mt.eq((select string_agg(distinct x ->> 'name', ',') from two, jsonb_array_elements(r -> 'rows') x), '가상학생A', 'name 칸은 이름 그대로(옛 화면과 같다)');
select mt.eq((select pg_temp.row_of(r, mt.id(61)) - 'id' - 'name' from two),
  '{"school": "가상초등학교", "grade": "초6", "class_names": ["수학 가반"]}'::jsonb, '첫째 학생의 학교·학년·반');
select mt.eq((select pg_temp.row_of(r, mt.id(66)) - 'id' - 'name' from two),
  '{"school": "모의중학교", "grade": "중1", "class_names": ["수학 나반"]}'::jsonb, '둘째 학생의 학교·학년·반');
select mt.ok((select bool_and((select array_agg(k order by k) from jsonb_object_keys(x) k) = array['class_names', 'grade', 'id', 'name', 'school'])
  from two, jsonb_array_elements(r -> 'rows') x), '학생 줄의 칸은 다섯 개뿐이다(연락처·보호자 없음)');
-- 과목을 안 주면 다니는 반 전부(이름순 · 최대 3개), 학교·학년이 비어 있으면 null.
select mt.eq(pg_temp.row_of(pg_temp.opt(mt.id(22), '{"kind":"students","q":"가상학생A"}'), mt.id(61)) -> 'class_names', '["수학 가반", "영어 가반"]'::jsonb, '과목 없이 물으면 다니는 반 전부');
select mt.eq(pg_temp.row_of(pg_temp.opt(mt.id(22), '{"kind":"students","q":"가상학생B"}'), mt.id(62)) - 'id' - 'name',
  '{"school": null, "grade": null, "class_names": ["수학 가반"]}'::jsonb, '학교·학년이 비어 있으면 null');
insert into public.classes (id, tenant_id, class_name, subject, teacher_id) values
  (mt.id(55), mt.id(11), '수학 다반', 'math', mt.id(26)), (mt.id(56), mt.id(11), '수학 라반', 'math', mt.id(26));
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values
  (mt.id(11), mt.id(61), mt.id(52), mt.d(-30)), (mt.id(11), mt.id(61), mt.id(55), mt.d(-30)), (mt.id(11), mt.id(61), mt.id(56), mt.d(-30));
select mt.eq(pg_temp.row_of(pg_temp.opt(mt.id(22), '{"kind":"students","subject_key":"math","q":"가상학생A"}'), mt.id(61)) -> 'class_names',
  '["수학 가반", "수학 나반", "수학 다반"]'::jsonb, '반 이름은 이름순 최대 3개');
-- 강사 범위: 지금 담당 반의 학생만 보이고, 반 이름도 담당 반만 온다(남의 반 이름을 내주지 않는다).
select mt.eq(pg_temp.row_of(pg_temp.opt(mt.id(25), '{"kind":"students","subject_key":"math","q":"가상학생A"}'), mt.id(61)) -> 'class_names',
  '["수학 가반"]'::jsonb, '강사에게는 담당 반 이름만');
select mt.ok(pg_temp.row_of(pg_temp.opt(mt.id(25), '{"kind":"students","subject_key":"math","q":"가상학생A"}'), mt.id(66)) is null, '강사는 남의 반 동명이인을 보지 못한다');
select mt.eq((pg_temp.opt(mt.id(25), '{"kind":"students","subject_key":"math"}') ->> 'total')::int, 3, '강사 범위의 학생 수는 그대로(3명)');

-- ② 원수업 반 후보(purpose=original): 그날 그 학생이 다니던 반. 지금은 종료된 반도 나온다 — 접수가 받아 주는 것과 같다.
insert into public.classes (id, tenant_id, class_name, subject, teacher_id, is_active, closed_at) values
  (mt.id(54), mt.id(11), '수학 옛반', 'math', mt.id(25), false, mt.d(-10));
insert into public.enrollments (tenant_id, student_id, class_id, start_date, end_date) values (mt.id(11), mt.id(62), mt.id(54), mt.d(-200), mt.d(-10));
create function pg_temp.orig(p_actor uuid, p_student uuid, p_date date) returns jsonb language sql as $$
  select pg_temp.opt(p_actor, jsonb_build_object('kind', 'classes', 'purpose', 'original', 'subject_key', 'math', 'student_id', p_student, 'session_date', p_date)) $$;
select mt.eq(pg_temp.names(pg_temp.orig(mt.id(22), mt.id(62), mt.d(-20))), '수학 가반,수학 옛반 (종료된 반)', '그날 다니던 반 둘 — 종료된 반은 이름에 표시');
select mt.eq((pg_temp.row_of(pg_temp.orig(mt.id(22), mt.id(62), mt.d(-20)), mt.id(54)) ->> 'active')::boolean, false, '종료된 반은 active = false');
select mt.eq((pg_temp.row_of(pg_temp.orig(mt.id(22), mt.id(62), mt.d(-20)), mt.id(51)) ->> 'active')::boolean, true, '운영 중인 반은 active = true');
select mt.eq(pg_temp.names(pg_temp.orig(mt.id(22), mt.id(62), mt.d(-5))), '수학 가반', '수강이 끝난 뒤의 날짜에는 옛반이 빠진다');
select mt.eq(pg_temp.names(pg_temp.orig(mt.id(22), mt.id(62), mt.d(-10))), '수학 가반', '수강 종료일 당일은 다니지 않은 날(종료일 미포함 — 접수와 같다)');
select mt.eq((pg_temp.orig(mt.id(22), mt.id(64), mt.d(-20)) ->> 'total')::int, 1, '다른 학생에게는 그 학생의 반만');
-- 후보가 내준 종료된 반으로 실제 접수가 된다(선택지와 명령이 같은 조건).
select mt.ok((mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(54), 'original_date', mt.d(-20),
  'reason', 'absence')) ->> 'id') is not null, '종료된 반의 지난 결석이 접수된다');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(54), 'original_date', mt.d(-5),
  'reason', 'absence'), null, 'invalid', '후보에 없던 날짜(수강 종료 뒤)는 접수도 거절한다');
-- 옛 호출(purpose 없음)은 종전 그대로 운영 중인 반만 — 그래서 전에는 종료된 반을 고를 수 없었다.
select mt.eq(pg_temp.names(pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'subject_key', 'math', 'student_id', mt.id(62)))), '수학 가반', '옛 호출은 운영 중인 반만');
-- 출결 반 후보(purpose=anchor)는 같은 날짜여도 종료된 반을 내주지 않는다(출결 반은 운영 중이어야 한다).
select mt.eq(pg_temp.names(pg_temp.opt(mt.id(22), jsonb_build_object('kind', 'classes', 'purpose', 'anchor', 'subject_key', 'math',
  'student_id', mt.id(62), 'session_date', mt.d(-20)))), '수학 가반', '출결 반 후보에는 종료된 반이 없다');
-- 강사 범위: 지금 담당 반만(접수가 담당 반의 결석만 받는 것과 같다). 남의 반 학생의 수강 이력을 내주지 않는다.
select mt.eq(pg_temp.names(pg_temp.orig(mt.id(25), mt.id(62), mt.d(-20))), '수학 가반,수학 옛반 (종료된 반)', '담임 강사는 자기 반 둘을 본다');
select mt.eq((pg_temp.orig(mt.id(26), mt.id(62), mt.d(-20)) ->> 'total')::int, 0, '다른 강사에게는 0건');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22),
  format('select public.makeup_options(%L::jsonb)', jsonb_build_object('kind', 'classes', 'purpose', 'original', 'session_date', mt.d(-20)))),
  'invalid', '학생 없이 purpose를 주면 거절');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22),
  format('select public.makeup_options(%L::jsonb)', jsonb_build_object('kind', 'students', 'purpose', 'original', 'student_id', mt.id(62), 'session_date', mt.d(-20)))),
  'invalid', 'purpose는 반 선택지에만');

-- ③ 옛 호출의 결과는 그대로다(칸만 더했다).
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"classes","subject_key":"math"}') ->> 'total')::int, 4, '운영 중인 수학 반 수(가·나·다·라)');
select mt.ok((select bool_and(x ?& array['id', 'name', 'subject_key', 'teacher_id', 'active'] and (x ->> 'active')::boolean)
  from jsonb_array_elements(pg_temp.opt(mt.id(22), '{"kind":"classes","subject_key":"math"}') -> 'rows') x), '반 줄: 옛 칸 + active(운영 중만 나온다)');
select mt.eq((pg_temp.opt(mt.id(22), '{"kind":"staff"}') ->> 'total')::int, 8, '직원 선택지는 그대로');
select mt.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'makeup_private' and p.proname = 'option_rows'), 1, '선택지 집합 함수는 하나만 남는다(옛 정의는 지웠다)');
select count(*) as passed from mt.passed;
rollback;
