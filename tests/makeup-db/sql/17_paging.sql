-- 넘겨 읽기: 하루 1001명 참여 명단(커서·쪽) · 변경 이력 · 대사 작업 목록 (보완 7 — MU-036·049·050)
-- 대량 행은 명령으로 만들 수 없어(학생당 하루 1건·자원 검사) 검증 전용 표식으로 직접 넣는다. 읽는 쪽은 실제 RPC다.
begin;
select mt.seed_on();
select mt.login(null);
select mt.as_command();
insert into public.students (id, tenant_id, name)
  select ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, mt.id(11), '대량학생' || lpad(n::text, 4, '0') from generate_series(1, 1001) n;
-- 회차 셋: 09:00(400명) · 10:00(400명) · 10:00 다른 회차(201명) — 같은 날짜·같은 시작 시각이 섞여도 순서가 안정이어야 한다.
insert into public.makeup_sessions (id, tenant_id, teacher_id, classroom_id, subject_key, session_date, start_time, end_time, capacity, created_by) values
  (mt.id(401), mt.id(11), mt.id(25), mt.id(41), 'math', mt.d(0), '09:00', '10:00', 200, mt.id(22)),
  (mt.id(402), mt.id(11), mt.id(25), mt.id(41), 'math', mt.d(0), '10:00', '11:00', 200, mt.id(22)),
  (mt.id(403), mt.id(11), mt.id(26), mt.id(42), 'math', mt.d(0), '10:00', '11:00', 200, mt.id(22));
insert into public.makeup_participants (tenant_id, session_id, student_id, subject_key, session_date, planned_minutes, anchor_class_id)
  select mt.id(11), case when n <= 400 then mt.id(401) when n <= 800 then mt.id(402) else mt.id(403) end,
         ('00000000-0000-4000-9000-' || lpad(n::text, 12, '0'))::uuid, 'math', mt.d(0), 60, mt.id(51) from generate_series(1, 1001) n;
select mt.end_command();
create function pg_temp.list(p_actor uuid, p jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_list_participants(%L::jsonb)', jsonb_build_object('session_date', mt.d(0)) || p)) $$;
create temp table expected as select array_agg(p.id order by to_char(s.start_time, 'HH24:MI'), p.id) as ids
  from public.makeup_participants p join public.makeup_sessions s on s.id = p.session_id where p.session_date = mt.d(0);
create temp table got (page integer, ids uuid[], truncated boolean, next_after jsonb, total integer);

-- ① 커서(after)로 세 쪽: 500 + 500 + 1. 한 줄도 빠지거나 겹치지 않고, 순서는 날짜·시작 시각·id.
do $$
declare r jsonb; v_after jsonb; n integer := 0;
begin
  loop
    n := n + 1;
    r := pg_temp.list(mt.id(22), jsonb_build_object('limit', 500) || case when v_after is null then '{}'::jsonb else jsonb_build_object('after', v_after) end);
    insert into got select n, array(select (x ->> 'id')::uuid from jsonb_array_elements(r -> 'participants') with ordinality t(x, o) order by o),
      (r ->> 'truncated')::boolean, r -> 'next_after', (r ->> 'total')::integer;
    exit when not (r ->> 'truncated')::boolean or n >= 9;
    -- 앱이 하는 대로 마지막 줄에서 커서를 만든다(응답의 next_after와 같아야 한다).
    v_after := (select jsonb_build_object('session_date', x ->> 'session_date', 'start_time', x ->> 'start_time', 'id', x ->> 'id')
                  from jsonb_array_elements(r -> 'participants') with ordinality t(x, o) order by o desc limit 1);
    if v_after <> r -> 'next_after' then raise exception 'next_after가 마지막 줄의 키와 다르다: % / %', v_after, r -> 'next_after'; end if;
  end loop;
end $$;
select mt.eq((select string_agg(cardinality(ids)::text || ':' || truncated, ',' order by page) from got), '500:true,500:true,1:false', 'MU-050 하루 1001명 = 세 쪽(500·500·1) — 마지막 쪽만 truncated 아님');
select mt.ok((select array_agg(i order by page, o) = (select ids from expected) from got, unnest(ids) with ordinality u(i, o)), '세 쪽을 이으면 전체 1001명 그대로(빠짐·겹침 없음 · 날짜→시작 시각→id 순)');
select mt.ok((select bool_and(total = 1001) and (select next_after from got where page = 3) = 'null'::jsonb from got), '매 쪽이 전체 수 1001을 말하고, 마지막 쪽의 next_after는 없다');
-- ② 쪽 번호(page)로도 같은 결과 — 앱의 지금 읽기 방식(page + page_size).
truncate got;
insert into got select n, array(select (x ->> 'id')::uuid from jsonb_array_elements(r -> 'participants') with ordinality t(x, o) order by o), (r ->> 'truncated')::boolean, r -> 'next_after', (r ->> 'total')::integer
  from generate_series(1, 3) n, lateral pg_temp.list(mt.id(22), jsonb_build_object('page', n, 'page_size', 500, 'limit', 500)) r;
select mt.ok((select array_agg(i order by page, o) = (select ids from expected) from got, unnest(ids) with ordinality u(i, o)), '쪽 번호로 읽어도 전체 1001명 그대로');
select mt.eq((select string_agg(truncated::text, ',' order by page) from got), 'true,true,false', '쪽 번호 방식의 truncated도 같다');
select mt.eq(jsonb_array_length(pg_temp.list(mt.id(22), '{"page":4,"page_size":500}') -> 'participants'), 0, '끝을 넘긴 쪽은 빈 쪽(앞 쪽을 다시 주지 않는다)');
select mt.eq(jsonb_array_length(pg_temp.list(mt.id(22), '{"limit":9999}') -> 'participants'), 500, '한 쪽의 상한은 500');
-- ③ 커서가 틀리면 조건을 무시하지 않고 거절한다(첫 쪽을 다시 주면 같은 줄을 두 번 읽는다).
select mt.throws(format('select pg_temp.list(%L::uuid, %L::jsonb)', mt.id(22), '{"after":{"session_date":"2026-01-01"}}'), 'invalid', '불완전한 커서 거절');
select mt.throws(format('select pg_temp.list(%L::uuid, %L::jsonb)', mt.id(22), '{"after":"abc"}'), 'invalid', '객체가 아닌 커서 거절');
-- ④ 범위는 그대로다: 강사가는 맡은 회차(09:00·10:00 = 800명)와 담당 반 출결 칸(전원 반1) → 1001명, 강사나는 맡은 회차 201명만.
select mt.eq((pg_temp.list(mt.id(25), '{"limit":1}') ->> 'total')::int, 1001, '강사가: 담당 반(출결 반)의 참여 전부');
select mt.eq((pg_temp.list(mt.id(26), '{"limit":500}') ->> 'total') || ':' || (pg_temp.list(mt.id(26), '{"limit":500}') ->> 'truncated'), '201:false', '강사나: 자기 회차의 201명만 · 한 쪽에 다 들어온다');
select mt.eq((pg_temp.list(mt.id(22), jsonb_build_object('teacher_id', mt.id(26), 'limit', 100, 'page', 3)) ->> 'total') || ':' ||
  jsonb_array_length(pg_temp.list(mt.id(22), jsonb_build_object('teacher_id', mt.id(26), 'limit', 100, 'page', 3)) -> 'participants'), '201:1', '조건(강사)과 쪽이 함께 걸린다');

-- ⑤ 변경 이력: 상세와 같은 범위 · 최신순 · 쪽 나눔. 범위 밖은 없음.
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1;
select mt.cmd(mt.id(22), 'adjust', jsonb_build_object('case_id', (select a1 from k), 'minutes', -1, 'reason', '합성 조정 ' || n), mt.rev('makeup_cases', (select a1 from k))) from generate_series(1, 120) n;
create function pg_temp.ev(p_actor uuid, p jsonb) returns jsonb language sql as $$
  select mt.run(p_actor, format('select public.makeup_case_events(%L, %L::jsonb)', (select a1 from k), p)) $$;
create temp table e1 as select pg_temp.ev(mt.id(22), '{"page":1,"page_size":50}') as r;
select mt.eq((select (r ->> 'total') || ':' || jsonb_array_length(r -> 'rows') || ':' || (r ->> 'page') || ':' || (r ->> 'page_size') from e1),
  (select count(*) from public.makeup_events where case_id = (select a1 from k)) || ':50:1:50', 'MU-050 이력도 전체 수와 함께 50건씩 넘겨 읽는다');
select mt.ok((select bool_and(x ?& array['id', 'event_type', 'actor_name', 'reason', 'occurred_at']) from e1, jsonb_array_elements(r -> 'rows') x), '이력 행의 키(id·event_type·actor_name·reason·occurred_at)');
select mt.eq((select r -> 'rows' -> 0 ->> 'reason' from e1) || ':' || (select r -> 'rows' -> 0 ->> 'actor_name' from e1), '합성 조정 120:관리자가', '최신순 · 행위자 이름 표기');
select mt.ok((select count(distinct x ->> 'id') = (select (r ->> 'total')::int from e1) from generate_series(1, 3) n,
  lateral jsonb_array_elements(pg_temp.ev(mt.id(22), jsonb_build_object('page', n, 'page_size', 50)) -> 'rows') x), '세 쪽을 이으면 이력 전부(겹침 없음)');
select mt.eq((pg_temp.ev(mt.id(22), '{"page_size":5000}') ->> 'page_size')::int, 100, '이력 한 쪽의 상한은 100');
select mt.throws(format('select pg_temp.ev(%L::uuid, %L::jsonb)', mt.id(26), '{}'), 'not_found', 'MU-036 범위 밖 강사에게 이력은 없음');
select mt.eq((mt.run(mt.id(22), format('select public.makeup_case_detail(%L)', (select a1 from k))) ->> 'events_total')::int || ':' ||
  jsonb_array_length(mt.run(mt.id(22), format('select public.makeup_case_detail(%L)', (select a1 from k))) -> 'events'),
  (select count(*) from public.makeup_events where case_id = (select a1 from k)) || ':50', '상세는 최근 50건 + 전체 수(나머지는 이력 RPC)');

-- ⑥ 대사 목록: 반영 작업도 따로 넘겨 읽는다(100건 초과가 조용히 잘리지 않는다).
insert into public.makeup_projection_jobs (tenant_id, kind, effect_key, state, last_error)
  select mt.id(11), 'attendance_effect', 'synthetic:' || n, case when n % 2 = 0 then 'failed' else 'pending' end, '합성' from generate_series(1, 230) n;
create temp table q as select mt.run(mt.id(22), 'select public.makeup_list_reconciliation(''{"projection_page":3,"projection_page_size":100}'')') as r;
select mt.eq((select (r ->> 'projection_total') || ':' || (r ->> 'projection_pending') || ':' || (r ->> 'projection_failed') || ':' || jsonb_array_length(r -> 'projection_jobs') || ':' || (r ->> 'projection_page') from q),
  '230:115:115:30:3', 'MU-050 반영 작업 230건 — 전체·대기·실패 수와 셋째 쪽 30건');
select mt.ok((select r ? 'last_run' and (r -> 'permissions' ->> 'reconcile')::boolean and (r -> 'permissions' ->> 'resolve_reconciliation')::boolean and (r -> 'permissions' ->> 'accept_manual_units')::boolean from q), '대사 목록에 마지막 실행과 권한 힌트가 실린다');
select mt.eq((mt.run(mt.id(25), 'select public.makeup_list_reconciliation()') ->> 'projection_total')::int, 0, '케이스·참여에 닿지 않는 작업은 강사 범위에 보이지 않는다');
select count(*) as passed from mt.passed;
rollback;
