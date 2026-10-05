-- 합성 시드 + 실행 도우미(격리 DB 전용). 실제 학생·직원 정보는 없다 — 이름은 전부 가상이다.
-- 날짜는 전부 "오늘(KST) + n일"로 만든다(어느 요일에 돌려도 같은 결과가 나오게).
--   mt.d(0) = 오늘: 정규 수업 없음 · mt.d(1) = 반1 정규 수업일 · mt.d(2) = 반2 정규 수업일 · mt.d(3) 이후 = 정규 없음
create function mt.d(n integer) returns date language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date + n $$;
create function mt.dow(p date) returns public.day_of_week language sql immutable as $$
  select ((array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p)::integer])::public.day_of_week $$;
-- 고정 id: 끝 두 자리로 구분한다(1x 학원 · 2x 직원 · 3x 강의실 · 4x 반 · 5x 학생).
create function mt.id(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- p_uid로 로그인한 authenticated 역할로 SQL 한 줄을 실행해 jsonb를 돌려준다.
create function mt.run(p_uid uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform mt.login(p_uid);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform mt.login(null);
  return v;
exception when others then
  reset role;
  raise;
end; $$;
create function mt.cmd(p_uid uuid, p_action text, p_payload jsonb, p_rev integer default null, p_cmd uuid default gen_random_uuid())
returns jsonb language sql as $$
  select mt.run(p_uid, format('select public.makeup_command(%L::uuid, %L, %L::jsonb, %s)', p_cmd, p_action, p_payload,
    coalesce(p_rev::text, 'null'))) $$;
create function mt.cmd_throws(p_uid uuid, p_action text, p_payload jsonb, p_rev integer, p_code text, p_name text)
returns void language sql as $$
  select mt.throws(format('select mt.cmd(%L::uuid, %L, %L::jsonb, %s)', p_uid, p_action, p_payload, coalesce(p_rev::text, 'null')),
    p_code, p_name) $$;
create function mt.rev(p_table text, p_id uuid) returns integer language plpgsql as $$
declare v integer;
begin execute format('select revision from public.%I where id = $1', p_table) into v using p_id; return v; end; $$;
-- 명령을 거치지 않는 합성 데이터용(검증 전용): 이 트랜잭션을 명령 안으로 표시한다. 운영 경로에는 없는 길이다.
create function mt.as_command() returns void language sql as $$
  select set_config('makeup.ctx', pg_current_xact_id()::text, true) $$;
create function mt.end_command() returns void language sql as $$ select set_config('makeup.ctx', '', true) $$;

create function mt.seed() returns void language plpgsql as $$
declare
  ta uuid := mt.id(11); tb uuid := mt.id(12);
  p3 record; p4 record;
begin
  insert into public.tenants (id, slug, name) values (ta, 'makeup-a', '가상학원 가'), (tb, 'makeup-b', '가상학원 나');
  insert into public.users (id, tenant_id, email, display_name, system_role, status) values
    (mt.id(21), ta, 'master@a.test', '원장가', 'master', 'active'),
    (mt.id(22), ta, 'admin1@a.test', '관리자가', 'admin', 'active'),
    (mt.id(23), ta, 'admin2@a.test', '관리자나', 'admin', 'active'),
    (mt.id(24), ta, 'manager@a.test', '매니저가', 'manager', 'active'),
    (mt.id(25), ta, 'teacher1@a.test', '강사가', 'teacher', 'active'),
    (mt.id(26), ta, 'teacher2@a.test', '강사나', 'teacher', 'active'),
    (mt.id(27), ta, 'desk@a.test', '데스크가', 'counselor', 'active'),
    (mt.id(28), ta, 'viewer@a.test', '열람가', 'viewer', 'active'),
    (mt.id(29), ta, 'gone@a.test', '퇴사강사', 'teacher', 'inactive'),
    (mt.id(31), tb, 'master@b.test', '원장나', 'master', 'active');
  -- 학생 계정: 실제 SQL 체인의 system_role에는 student 값이 없을 수 있다(--real-chain) — 있을 때만 넣는다.
  begin
    execute format('insert into public.users (id, tenant_id, email, display_name, system_role, status) values (%L, %L, %L, %L, %L, %L)',
      mt.id(20), ta, 'student@a.test', '학생계정', 'student', 'active');
  exception when invalid_text_representation then null;
  end;
  -- 데스크(상담 역할)는 개인 예외로 지점 전체 운영 권한을 받는다.
  insert into public.tenant_settings (tenant_id, data) values
    (ta, jsonb_build_object('permissions', jsonb_build_object('userOverrides',
      jsonb_build_array(jsonb_build_object('userId', mt.id(27), 'menu', 'makeups', 'access', 'full'))))),
    (tb, '{}'::jsonb);
  insert into public.classrooms (id, tenant_id, name, capacity) values
    (mt.id(41), ta, '가상 1강의실', 4), (mt.id(42), ta, '가상 2강의실', 2), (mt.id(43), ta, '가상 3강의실', null),
    (mt.id(49), tb, '나 강의실', 5);
  insert into public.classes (id, tenant_id, class_name, subject, teacher_id, classroom_id) values
    (mt.id(51), ta, '수학 가반', 'math', mt.id(25), mt.id(41)),
    (mt.id(52), ta, '수학 나반', 'math', mt.id(26), mt.id(42)),
    (mt.id(53), ta, '영어 가반', 'english', mt.id(26), mt.id(42)),
    (mt.id(59), tb, '나 수학반', 'math', mt.id(31), mt.id(49));
  insert into public.students (id, tenant_id, name) values
    (mt.id(61), ta, '가상학생A'), (mt.id(62), ta, '가상학생B'), (mt.id(63), ta, '가상학생C'),
    (mt.id(64), ta, '가상학생D'), (mt.id(65), ta, '가상학생E'), (mt.id(69), tb, '나학생');
  insert into public.enrollments (tenant_id, student_id, class_id, start_date) values
    (ta, mt.id(61), mt.id(51), mt.d(-200)), (ta, mt.id(62), mt.id(51), mt.d(-200)), (ta, mt.id(63), mt.id(51), mt.d(-200)),
    (ta, mt.id(64), mt.id(52), mt.d(-200)), (ta, mt.id(65), mt.id(52), mt.d(-200)), (ta, mt.id(61), mt.id(53), mt.d(-200)),
    (tb, mt.id(69), mt.id(59), mt.d(-200));
  -- 반1 정규 = d(1) 요일의 3~4교시 · 반2 정규 = d(2) 요일의 3~4교시(그 날짜의 교시표에서 시각을 가져온다).
  select min(t.start_time) as s, max(t.end_time) as e into p3 from makeup_private.period_table(ta, 'math', mt.d(1)) t where t.ord in (3, 4);
  select min(t.start_time) as s, max(t.end_time) as e into p4 from makeup_private.period_table(ta, 'math', mt.d(2)) t where t.ord in (3, 4);
  insert into public.class_schedules (id, tenant_id, class_id, day_of_week, start_time, end_time, valid_from) values
    (mt.id(71), ta, mt.id(51), mt.dow(mt.d(1)), p3.s, p3.e, mt.d(-200)),
    (mt.id(72), ta, mt.id(52), mt.dow(mt.d(2)), p4.s, p4.e, mt.d(-200));
end; $$;

-- 보강관리를 켠 상태로 시작한다(원장이 configure).
create function mt.seed_on() returns void language plpgsql as $$
begin
  perform mt.seed();
  perform mt.cmd(mt.id(21), 'configure', '{"mode":"on"}');
end; $$;

-- 결석 접수 + 승인까지 끝낸 케이스 id(학생·반·원수업일·승인 분).
create function mt.approved_case(p_student uuid, p_class uuid, p_date date, p_minutes integer) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', p_student, 'original_class_id', p_class,
          'original_date', p_date, 'reason', 'absence')) ->> 'id')::uuid;
  perform mt.cmd(mt.id(22), 'approve', jsonb_build_object('case_id', v, 'target_minutes', p_minutes), mt.rev('makeup_cases', v));
  return v;
end; $$;

-- 예약 한 건(강사1 · 1강의실)을 잡고 참여 id를 돌려준다.
create function mt.reserved(p_actor uuid, p_student uuid, p_case uuid, p_date date, p_periods text[], p_minutes integer)
returns uuid language sql as $$
  select (mt.cmd(p_actor, 'reserve', jsonb_build_object('student_id', p_student, 'session_date', p_date,
    'period_ids', to_jsonb(p_periods), 'teacher_id', mt.id(25), 'classroom_id', mt.id(41),
    'allocations', jsonb_build_array(jsonb_build_object('case_id', p_case, 'minutes', p_minutes)))) ->> 'id')::uuid $$;

-- 검증 전용 시간 이동: 회차와 그 참여의 날짜를 한 문장으로 옮긴다(복합 FK라 따로는 못 옮긴다).
-- 예약은 오늘 이후만, 참여 기록은 오늘 이전만 되므로 "지난 회차"를 만들 때 쓴다. 운영 경로에는 없는 길이다.
create function mt.backdate(p_session uuid, p_date date) returns void language plpgsql as $$
begin
  perform mt.as_command();
  with s as (update public.makeup_sessions set session_date = p_date where id = p_session returning id)
  update public.makeup_participants p set session_date = p_date from s where p.session_id = s.id;
  update public.makeup_reservations r set makeup_date = p_date
   where r.id in (select m.legacy_id from public.makeup_legacy_maps m join public.makeup_participants p on p.id = m.participant_id
                   where p.session_id = p_session and m.state = 'active');
  perform mt.end_command();
end; $$;
-- 참여(수기 확인: 분 + 지도 근거) → 제출 → 검토를 한 번에(강사1 참여·제출, 관리자1 검토). 실시 기록 id를 돌려준다.
create function mt.fulfill(p_part uuid, p_actual integer, p_recs jsonb) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', p_part,
    'status', case when p_actual < (select planned_minutes from public.makeup_participants where id = p_part) then 'partial' else 'present' end,
    'actual_minutes', p_actual, 'learning_summary', '합성 지도 내용'));
  v := (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', p_part)) ->> 'id')::uuid;
  perform mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', v, 'recognitions', p_recs), mt.rev('makeup_fulfillments', v));
  return v;
end; $$;
