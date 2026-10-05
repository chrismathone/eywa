-- 읽기 RPC: 범위·페이지·총수·카드 숫자·상세·참여 명단 (MU-048·049·050·059·077)
begin;
select mt.seed_on();
select mt.login(null);
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 120) as a1,
  mt.approved_case(mt.id(64), mt.id(52), mt.d(-5), 120) as d1;
create temp table p as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', (select id from p), 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성 지도 내용'));
select mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p), 'learning_summary', '합성'));
select mt.cmd(mt.id(22), 'adjust', jsonb_build_object('case_id', (select d1 from k), 'due_date', mt.d(-1), 'reason', '합성 기한'), mt.rev('makeup_cases', (select d1 from k)));

-- MU-050 1001건 초과: 검증 전용 경로로 미처리 건 1,005건을 더 만든다(학생C · 반1 · 서로 다른 원수업일).
select mt.as_command();
insert into public.makeup_cases (tenant_id, student_id, subject_key, original_class_id, original_date, occurrence_key, reason)
  select mt.id(11), mt.id(63), 'math', mt.id(51), mt.d(-10 - g), 'day:' || mt.id(63) || ':' || mt.id(51) || ':' || (mt.d(-10 - g))::text, 'absence'
    from generate_series(1, 1005) g;
select mt.end_command();
create temp table l as select mt.run(mt.id(22), 'select public.makeup_list_cases(''{"page_size":100}'')') as r;
select mt.eq((select (r ->> 'total')::int from l), 1007, 'MU-050 총수 = 1,007(1000행에서 잘리지 않는다)');
select mt.eq((select jsonb_array_length(r -> 'rows') from l), 100, '한 페이지는 100행');
select mt.ok((select (r ->> 'last_success_at') is not null and r ->> 'mode' = 'on' from l), 'MU-048 마지막 성공 시각·운영 상태 포함');
create temp table walked (id uuid);
do $$
declare v jsonb; i integer := 1;
begin
  loop
    v := mt.run(mt.id(22), format('select public.makeup_list_cases(''{"page_size":100,"page":%s}'')', i));
    exit when jsonb_array_length(v -> 'rows') = 0;
    insert into walked select (x ->> 'id')::uuid from jsonb_array_elements(v -> 'rows') x;
    i := i + 1;
  end loop;
end $$;
select mt.eq((select count(*)::int || ':' || count(distinct id)::int from walked), '1007:1007', 'MU-050 전체 순회 = 총수(중복·누락 없음)');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases(''{"page_size":5000}'')') ->> 'page_size')::int, 100, '페이지 크기 상한 100');

-- MU-059 카드 숫자 = 그 카드로 거른 목록의 총수(같은 조건식). 한 건에 표시가 여럿 붙을 수 있다.
create temp table cards as select key, value::int as n from jsonb_each_text((select r -> 'counts' from l))
  where key in ('pending', 'unassigned', 'unscheduled', 'due_soon', 'overdue', 'record_missing', 'review_pending', 'recon_open');
select mt.ok((select bool_and(c.n = (mt.run(mt.id(22), format('select public.makeup_list_cases(''{"flag":"%s","page_size":1}'')', c.key)) ->> 'total')::int) from cards c), 'MU-059 카드 숫자 = 같은 필터 목록 총수');
-- (월 경계에 걸리면 수납 확인 대사가 하나 열린다 — 날짜에 따라 0 또는 1.)
create temp table mx as select (to_char(mt.d(-6), 'YYYY-MM') <> to_char(mt.d(0), 'YYYY-MM'))::int as n;
select mt.eq((select string_agg(key || '=' || n, ' ' order by key) from cards),
  format('due_soon=0 overdue=1 pending=1005 recon_open=%s record_missing=0 review_pending=1 unassigned=1007 unscheduled=1', (select n from mx)), '카드 숫자 값');
select mt.ok((select sum(n) from cards) > (select (r -> 'counts' ->> 'active')::int from l), 'MU-059 표시는 겹치므로 카드 합 ≠ 총수');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases(''{"flag":"review_pending"}'')') -> 'rows' -> 0 ->> 'next_action'), 'assign_owner', '담당 없는 건의 다음 할 일은 담당 지정이 먼저');
select mt.cmd(mt.id(22), 'assign', jsonb_build_object('case_id', (select a1 from k), 'owner_id', mt.id(25)), mt.rev('makeup_cases', (select a1 from k)));
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases(''{"flag":"review_pending"}'')') -> 'rows' -> 0 ->> 'next_action'), 'verify', '검토 대기 건의 다음 할 일');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases(''{"q":"학생D","page_size":10}'')') ->> 'total')::int, 1, '학생 이름 검색');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases(''{"tab":"closed"}'')') ->> 'total')::int, 0, '종결 탭');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_list_cases(''{"tab":"nope"}'')'), 'invalid', '알 수 없는 탭은 거절(빈 목록으로 답하지 않는다)');
-- MU-077 강사 범위: 목록·집계 모두 담당 반 건만(반1 강사는 1,006건, 반2 강사는 1건).
select mt.eq((mt.run(mt.id(25), 'select public.makeup_list_cases(''{"page_size":1}'')') ->> 'total')::int, 1006, 'MU-077 반1 강사 목록 총수');
select mt.eq((mt.run(mt.id(26), 'select public.makeup_list_cases(''{"page_size":1}'')') -> 'counts' ->> 'active')::int, 1, 'MU-077 반2 강사 집계');

-- 상세: 약속한 키가 모두 있고, 행동 권한은 계정에 따라 다르다.
create temp table d as select mt.run(mt.id(22), format('select public.makeup_case_detail(%L)', (select a1 from k))) as r;
select mt.ok((select r ?& array['mode','case','policy','quantities','sources','sessions','participants','allocations','fulfillments',
  'recognitions','adjustments','events','reconciliation','projection_jobs','legacy_maps','permissions'] from d), '상세 반환 키');
select mt.eq((select r -> 'quantities' ->> 'outstanding' || '/' || (r -> 'quantities' ->> 'committed') || '/' || (r -> 'quantities' ->> 'reservable') from d), '120/110/10', '상세 수량(O/C/R)');
select mt.eq((select jsonb_array_length(r -> 'sessions') || ':' || jsonb_array_length(r -> 'participants') || ':' || jsonb_array_length(r -> 'fulfillments') from d), '1:1:1', '상세 회차·참여·실시');
select mt.ok((select jsonb_array_length(r -> 'events') >= 4 from d), '상세 변경 이력');
select mt.ok((select (r -> 'permissions' ->> 'verify')::boolean and not (r -> 'permissions' ->> 'approve')::boolean from d), '관리자: 검토 가능 · 이미 승인됨');
select mt.ok((select not (x -> 'permissions' ->> 'verify')::boolean and not (x -> 'permissions' ->> 'waive')::boolean
  from (select mt.run(mt.id(25), format('select public.makeup_case_detail(%L)', (select a1 from k))) as x) q), '강사: 검토·면제 불가');
select mt.ok((select r::text !~ 'parent_phone|student_phone' from d), '상세에 보호자 연락처를 싣지 않는다');

-- 참여 명단: 날짜·학생·예약 id로 읽는다. 연결 여부(legacy_maps) 포함. 범위 밖 강사는 0건.
create temp table pl as select mt.run(mt.id(25), format('select public.makeup_list_participants(''{"session_date":"%s"}'')', mt.d(0))) as r;
select mt.eq((select jsonb_array_length(r -> 'participants') from pl), 1, '참여 명단 1건');
select mt.ok((select r -> 'participants' -> 0 ?& array['id','revision','session_id','student_id','subject_key','session_date','class_id','teacher_id',
  'status','report_id','attendance_record_id','legacy_reservation_id','case_ids'] from pl), '참여 한 건의 키');
select mt.eq((select (r -> 'participants' -> 0 ->> 'legacy_reservation_id')::uuid from pl), (select id from public.makeup_reservations), '참여에 연결된 예약 id');
select mt.eq((select jsonb_array_length(r -> 'legacy_maps') from pl), 1, '연결 행 1건');
select mt.eq(jsonb_array_length(mt.run(mt.id(26), format('select public.makeup_list_participants(''{"session_date":"%s"}'')', mt.d(0))) -> 'participants'), 0, '범위 밖 강사는 참여 명단 0건');
select mt.eq(jsonb_array_length(mt.run(mt.id(26), format('select public.makeup_list_participants(''{"legacy_reservation_ids":["%s"]}'')', (select id from public.makeup_reservations))) -> 'legacy_maps'), 0,
  'MU-036 예약 id를 직접 넣어도 범위 밖 강사에게는 연결이 보이지 않는다(있는지조차 알려 주지 않는다)');
select mt.eq(jsonb_array_length(mt.run(mt.id(25), format('select public.makeup_list_participants(''{"legacy_reservation_ids":["%s"],"session_date":"%s"}'')', (select id from public.makeup_reservations), mt.d(-400))) -> 'legacy_maps'), 1,
  '범위 안 강사는 그 날짜 조건에 참여가 안 걸려도 예약 id로 연결을 확인한다');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_participants(''{"limit":0}'')') ->> 'truncated')::boolean, false, '명단 상한 안이면 truncated=false');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_reconciliation()') ->> 'total')::int, (select n from mx), '열린 대사 목록 총수');
select count(*) as passed from mt.passed;
rollback;
