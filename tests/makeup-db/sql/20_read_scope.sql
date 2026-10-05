-- 읽기 출력의 범위 정리 · 수납 정보 가림 (잔여 1·2·3 — MU-036·038·077)
-- 한 회차에 학생A(건 a1 = 강사가 반 · a2 = 강사나 반)와 학생B(건 b1 = 강사가 반)가 함께 있다. 강사나의 범위는 a2뿐이다.
begin;
select mt.seed_on();
select mt.login(null);
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(61), mt.id(52), mt.d(-200));
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-13), 240) as a1,
  mt.approved_case(mt.id(61), mt.id(52), mt.d(-40), 240) as a2, mt.approved_case(mt.id(62), mt.id(51), mt.d(-13), 240) as b1;
create temp table sa as select mt.cmd(mt.id(22), 'reserve', jsonb_build_object('student_id', mt.id(61), 'session_date', mt.d(0), 'period_ids', '["1","2"]'::jsonb,
  'teacher_id', mt.id(25), 'classroom_id', mt.id(41), 'anchor_class_id', mt.id(51), 'allocations', jsonb_build_array(
    jsonb_build_object('case_id', (select a1 from k), 'minutes', 55), jsonb_build_object('case_id', (select a2 from k), 'minutes', 55)))) as r;
create temp table ids as select (r ->> 'session_id')::uuid as s, (r ->> 'participant_id')::uuid as pa,
  (select (mt.cmd(mt.id(22), 'reserve', jsonb_build_object('session_id', r ->> 'session_id', 'student_id', mt.id(62),
     'allocations', jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 110)))) ->> 'participant_id')::uuid) as pb from sa;
create temp table resv as select m.participant_id, min(m.legacy_id::text)::uuid as id from public.makeup_legacy_maps m where m.state = 'active' group by 1;
-- 둘 다 왔다고 기록하고, 두 칸 모두 수기 시수 3(예상 1.0)으로 찍는다 → 참여마다 시수 대사. 학생A는 월 경계라 수납 확인도 생긴다.
select mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', p, 'status', 'present', 'actual_minutes', 110, 'learning_summary', '합성'))
  from (select pa as p from ids union all select pb from ids) x;
insert into public.attendance_records (tenant_id, class_id, student_id, session_date, status, session_units, recorded_by)
  values (mt.id(11), mt.id(51), mt.id(61), mt.d(0), 'present', 3, mt.id(25)), (mt.id(11), mt.id(51), mt.id(62), mt.d(0), 'present', 3, mt.id(25));
create function pg_temp.parts(p_actor uuid, p jsonb) returns jsonb language sql as $$ select mt.run(p_actor, format('select public.makeup_list_participants(%L::jsonb)', p)) $$;
create function pg_temp.recs(p_actor uuid) returns jsonb language sql as $$ select mt.run(p_actor, 'select public.makeup_list_reconciliation(''{"state":"all"}'')') $$;
create function pg_temp.detail(p_actor uuid, p_case uuid) returns jsonb language sql as $$ select mt.run(p_actor, format('select public.makeup_case_detail(%L)', p_case)) $$;
-- 범위 밖 번호(건 a1 · b1 · 학생B의 참여)가 문자열 어디에도 없는가.
create function pg_temp.clean(p jsonb) returns boolean language sql as $$
  select p::text not like '%' || (select a1 from k) || '%' and p::text not like '%' || (select b1 from k) || '%' and p::text not like '%' || (select pb from ids) || '%' $$;
create function pg_temp.row_of(p jsonb, p_kind text) returns jsonb language sql as $$ select x from jsonb_array_elements(p -> 'rows') x where x ->> 'kind' = p_kind limit 1 $$;

-- ① 참여 명단: 강사나는 자기 반 재원생인 학생A의 참여만 보고, 그 참여에 걸린 건도 범위 안(a2)만 본다.
create temp table l26 as select pg_temp.parts(mt.id(26), jsonb_build_object('session_date', mt.d(0))) as r;
select mt.eq((select (r ->> 'total') || ':' || (r -> 'participants' -> 0 ->> 'id') || ':' || (r -> 'participants' -> 0 -> 'case_ids')::text from l26),
  '1:' || (select pa from ids) || ':["' || (select a2 from k) || '"]', 'MU-036 참여의 case_ids는 행위자 범위 안의 건만');
select mt.eq((select r -> 'participants' -> 0 ->> 'original_date' from l26), mt.d(-40)::text, '원수업일도 범위 안 건의 것만(범위 밖 건의 날짜가 섞이지 않는다)');
select mt.ok((select pg_temp.clean(r) from l26), '참여 명단 어디에도 범위 밖 건·참여 번호가 없다');
-- ② 예약 id를 직접 넣어도 범위가 걸린다: 학생B의 연결은 0건, 학생A의 연결은 보이되 범위 밖 건 번호는 비운다.
select mt.eq(jsonb_array_length(pg_temp.parts(mt.id(26), jsonb_build_object('legacy_reservation_ids', jsonb_build_array((select id from resv where participant_id = (select pb from ids))))) -> 'legacy_maps'), 0,
  'MU-036 요청한 예약 id라도 범위 밖 연결은 돌려주지 않는다');
create temp table m26 as select pg_temp.parts(mt.id(26), jsonb_build_object('legacy_reservation_ids', jsonb_build_array((select id from resv where participant_id = (select pa from ids))))) as r;
select mt.eq((select jsonb_array_length(r -> 'legacy_maps') || ':' || (select count(*) from jsonb_array_elements(r -> 'legacy_maps') x where x ->> 'case_id' is null) from m26), '2:1',
  '범위 안 참여의 연결 2줄 — 범위 밖 건(a1)의 줄은 건 번호를 비운다');
select mt.ok((select pg_temp.clean(r) from m26), '연결 목록에도 범위 밖 번호가 없다');
select mt.eq(jsonb_array_length(pg_temp.parts(mt.id(22), jsonb_build_object('legacy_reservation_ids', jsonb_build_array((select id from resv where participant_id = (select pb from ids))))) -> 'legacy_maps'), 1,
  '지점 전체 권한은 그대로 본다');

-- ③ 대사·반영 작업 목록: 같은 회차의 다른 학생 항목은 보이지 않고, 보이는 항목도 범위 안 번호만 싣는다.
create temp table r26 as select pg_temp.recs(mt.id(26)) as r;
select mt.eq((select count(*)::int from r26, jsonb_array_elements(r -> 'rows') x where x ->> 'kind' = 'units_mismatch'), 1, 'MU-038 같은 회차 다른 학생(학생B)의 시수 대사는 보이지 않는다');
select mt.eq((select (pg_temp.row_of(r, 'units_mismatch') -> 'case_ids')::text || (pg_temp.row_of(r, 'units_mismatch') -> 'detail' -> 'case_ids')::text from r26),
  repeat('["' || (select a2 from k) || '"]', 2), '대사 행과 그 detail의 case_ids는 범위 안 건만');
select mt.ok((select pg_temp.clean(r) from r26), '대사·작업 목록 어디에도 범위 밖 번호가 없다(묶음 키·효과 키 포함)');
select mt.eq((select (r ->> 'projection_total') || ':' || (r -> 'projection_jobs' -> 0 -> 'case_ids')::text || ':' || (r -> 'projection_jobs' -> 0 -> 'payload' ->> 'restricted') from r26),
  '1:["' || (select a2 from k) || '"]:true', '반영 작업도 범위 안 건만 — 범위 밖 건이 섞인 작업의 본문은 가린다');
select mt.eq((select count(*)::int from jsonb_array_elements(pg_temp.recs(mt.id(22)) -> 'rows') x where x ->> 'kind' = 'units_mismatch'), 2, '지점 전체 권한은 두 학생의 대사를 다 본다');
-- 상세·이력도 같다.
create temp table d26 as select pg_temp.detail(mt.id(26), (select a2 from k)) as r;
select mt.eq((select jsonb_array_length(r -> 'allocations') || ':' || (r -> 'allocations' -> 0 ->> 'case_id') from d26), '1:' || (select a2 from k), '상세의 배정은 범위 안 건의 것만(같은 참여의 다른 건 배정 제외)');
select mt.ok((select pg_temp.clean(r) from d26) and pg_temp.clean(mt.run(mt.id(26), format('select public.makeup_case_events(%L)', (select a2 from k)))), '상세·이력 어디에도 범위 밖 번호가 없다');
select mt.throws(format('select pg_temp.detail(%L::uuid, %L::uuid)', mt.id(26), (select b1 from k)), 'not_found', '범위 밖 건의 상세는 없음');
-- 종결 차단도 관계있는 것만: 학생B의 시수 대사가 학생A의 건을 막지 않는다(내부 판정은 행위자와 무관하다).
select mt.eq((makeup_private.close_blockers(mt.id(11), (select a2 from k)) ->> 'reconciliation') || ':' || (makeup_private.close_blockers(mt.id(11), (select b1 from k)) ->> 'reconciliation'),
  '1:1', '참여 단위 항목은 그 참여의 건만 막는다(같은 회차의 다른 학생 건은 막지 않는다)');

-- ④ 수납 정보: 수납 읽기 권한이 없으면 수납 확인 대사는 "있다"만 보이고, 다른 대사의 수납 기준도 빠진다.
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select pa from ids)), 1, '월 경계 참여에 수납 확인 대사가 생겼다');
create function pg_temp.bill(p_actor uuid) returns text language sql as $$
  select (x ->> 'restricted') || ':' || (x -> 'detail' = '{}'::jsonb) || ':' || (x ->> 'summary') || ':' || (x -> 'detail' ? 'quantity_basis') || ':' || coalesce(x ->> 'participant_id', 'null')
    from jsonb_array_elements(pg_temp.recs(p_actor) -> 'rows') x where x ->> 'kind' = 'billing_review' and (x -> 'case_ids') ? (select a2::text from k) limit 1 $$;
select mt.eq(pg_temp.bill(mt.id(25)), 'true:true:수납 담당자가 확인할 항목이 있습니다:false:null', 'MU-077 강사: 수납 확인 대사는 항목이 있다는 사실만(내용·참여 번호 없음)');
select mt.eq(pg_temp.bill(mt.id(27)), 'true:true:수납 담당자가 확인할 항목이 있습니다:false:null', '데스크(지점 전체 운영 · 수납 권한 없음)도 가려진다');
select mt.eq(pg_temp.bill(mt.id(24)), 'false:false:수납 기준을 확인해 주세요:true:' || (select pa from ids), '매니저(수납 읽기 권한)는 수납 기준·예상 소비를 본다');
select mt.eq((select (pg_temp.row_of(pg_temp.recs(mt.id(25)), 'units_mismatch') -> 'detail' ? 'quantity_basis') || ':' || (pg_temp.row_of(pg_temp.recs(mt.id(24)), 'units_mismatch') -> 'detail' ? 'quantity_basis')),
  'false:true', '시수 대사의 수납 기준(quantity_basis)도 수납 읽기 권한에만');
select mt.ok((select not exists (select 1 from jsonb_array_elements(pg_temp.detail(mt.id(25), (select a2 from k)) -> 'reconciliation') x
  where x::text like '%expected_consumption%' or x::text like '%quantity_basis%')), '상세에서도 수납 내용은 나가지 않는다');
select mt.eq((pg_temp.recs(mt.id(25)) -> 'permissions' ->> 'read_billing') || ':' || (pg_temp.recs(mt.id(24)) -> 'permissions' ->> 'read_billing'), 'false:true', '화면용 힌트(read_billing)');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select to_jsonb(count(*)) from public.makeup_reconciliation'), '42501', '표 직접 읽기는 누구에게도 닫혀 있다(RLS · 권한 회수)');
-- 수납 권한이 없는 관리자는 수납 확인 대사를 처리하지도 못한다(역할 설정으로 관리자의 수납을 닫아 본다).
update public.tenant_settings set data = jsonb_set(data, '{permissions,overrides}', '[{"menu":"billing","role":"admin","access":"none"}]') where tenant_id = mt.id(11);
create temp table br as select id, revision from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select pa from ids);
select mt.eq(pg_temp.bill(mt.id(22)), 'true:true:수납 담당자가 확인할 항목이 있습니다:false:null', '수납이 닫힌 관리자에게도 가려진다');
select mt.cmd_throws(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from br), 'reason', '합성'), (select revision from br), 'forbidden', '수납 권한 없이는 수납 확인 대사를 처리할 수 없다');
update public.tenant_settings set data = data #- '{permissions,overrides}' where tenant_id = mt.id(11);
select mt.eq(mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from br), 'reason', '수납 담당 확인'), (select revision from br)) ->> 'state', 'resolved', '수납 권한이 있는 관리자는 처리한다');

-- ⑤ 회차 단위 항목(강사 부재)은 그 회차의 모든 건에 닿지만, 내보낼 때는 행위자 범위의 건만 싣는다.
create temp table p2 as select mt.reserved(mt.id(22), mt.id(61), (select a2 from k), mt.d(3), array['1','2'], 55) as id;
create temp table s2 as select session_id as id from public.makeup_participants where id = (select id from p2);
select mt.cmd(mt.id(22), 'reserve', jsonb_build_object('session_id', (select id from s2), 'student_id', mt.id(62),
  'allocations', jsonb_build_array(jsonb_build_object('case_id', (select b1 from k), 'minutes', 55))));
update public.users set status = 'inactive' where id = mt.id(25);
create temp table t26 as select pg_temp.row_of(pg_temp.recs(mt.id(26)), 'teacher_inactive') as x;
select mt.eq((select (x -> 'case_ids')::text || (x -> 'detail' -> 'case_ids')::text from t26), repeat('["' || (select a2 from k) || '"]', 2), '회차 단위 항목: 강사나에게는 자기 범위의 건(a2)만');
select mt.ok((select pg_temp.clean(x) from t26), '회차 단위 항목에도 범위 밖 번호가 없다');
select mt.eq((select jsonb_array_length(pg_temp.row_of(pg_temp.recs(mt.id(22)), 'teacher_inactive') -> 'case_ids')), 2, '지점 전체 권한은 닿는 건 둘(a2 · b1)을 다 본다');
select count(*) as passed from mt.passed;
rollback;
