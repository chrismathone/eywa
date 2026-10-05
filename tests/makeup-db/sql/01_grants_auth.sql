-- 권한·격리: 표 권한 0 · RPC만 · 행위자 위조 불가 · 역할별 허용/거절 (MU-023·036·038·039·041·077)
begin;
select mt.seed_on();

-- MU-041 표 권한: anon·authenticated는 전부 0, service_role은 SELECT만. RLS 켜짐.
create temp table ledger as
  select c.oid, c.relname, c.relrowsecurity from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname ~ '^makeup_' and c.relname <> 'makeup_reservations';
select mt.eq((select count(*)::int from ledger), 15, '원장 표 15개(실행 기록 포함)');
select mt.ok(not exists (
  select 1 from ledger c, unnest(array['anon','authenticated']) r, unnest(array['select','insert','update','delete']) p
   where has_table_privilege(r, c.oid, p)), 'MU-041 anon·authenticated 표 권한 0');
select mt.ok(not exists (
  select 1 from ledger c, unnest(array['insert','update','delete','truncate']) p
   where has_table_privilege('service_role', c.oid, p)), 'MU-041 service_role 쓰기 권한 0');
select mt.ok((select bool_and(has_table_privilege('service_role', c.oid, 'select') and c.relrowsecurity) from ledger c),
  'service_role 읽기 + RLS 켜짐');
select mt.ok(has_function_privilege('authenticated', 'public.makeup_command(uuid,text,jsonb,integer)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_command(uuid,text,jsonb,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.makeup_command(uuid,text,jsonb,integer)', 'execute'), '명령 RPC는 authenticated만');
select mt.ok(not has_function_privilege('anon', 'public.makeup_list_cases(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_case_detail(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_list_participants(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_list_reconciliation(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_options(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_candidates(jsonb)', 'execute'), '읽기 RPC anon 거절');
select mt.eq((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^makeup_'
  and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('service_role', p.oid, 'execute')
  and not has_function_privilege('anon', p.oid, 'execute')), 11, '공개 RPC 11개(명령 1 · 읽기 9 · 반영 실패 기록 1) 전부 authenticated 전용');
-- 주기 대사 함수만 service_role 전용이다(행위자 없는 탐지 — 원장·출결을 고치지 않는다).
select mt.eq((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^makeup_'
  and has_function_privilege('service_role', p.oid, 'execute')), 'makeup_reconcile_tenants', 'service_role이 실행할 수 있는 것은 주기 대사 하나뿐');
select mt.ok(not has_function_privilege('authenticated', 'public.makeup_reconcile_tenants()', 'execute')
  and not has_function_privilege('anon', 'public.makeup_reconcile_tenants()', 'execute'), '주기 대사는 로그인 사용자·anon이 부를 수 없다');
select mt.ok(not has_function_privilege('service_role', 'public.makeup_note_effect_gap(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_note_effect_gap(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_case_events(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.makeup_projection_evidence(text)', 'execute'), '반영 실패 기록·이력·증거 조회도 anon·service_role 거절');
select mt.ok(not has_schema_privilege('authenticated', 'makeup_private', 'usage')
  and not has_schema_privilege('anon', 'makeup_private', 'usage'), '내부 스키마는 API 역할에 닫힘');
select mt.ok((select bool_and(p.prosecdef and p.proconfig::text like '%search_path%') from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname ~ '^makeup_'), '공개 RPC는 definer + search_path 고정');

-- 직접 쓰기·읽기 거절(authenticated).
select mt.login(mt.id(21));
set local role authenticated;
select mt.throws('select count(*) from public.makeup_cases', '42501', 'authenticated 직접 SELECT 거절');
select mt.throws('insert into public.makeup_events (tenant_id, entity_type, entity_id, event_type) values (public.auth_tenant_id(), ''case'', gen_random_uuid(), ''x'')', '42501', 'authenticated 직접 INSERT 거절');
reset role;
-- service_role: 행위자 없는 명령 금지 + 직접 쓰기 거절.
select mt.login(null);
set local role service_role;
select mt.throws('select public.makeup_command(gen_random_uuid(), ''intake'', ''{}''::jsonb, null)', '42501', 'service_role 명령 실행 권한 없음');
select mt.throws('update public.makeup_cases set note = ''x''', '42501', 'service_role 직접 UPDATE 거절');
reset role;
-- 권한이 실수로 다시 열려도 명령 밖 쓰기는 트리거가 거절한다.
select mt.throws('insert into public.makeup_policy_versions (tenant_id, label, effective_from) values (mt.id(11), ''x'', current_date)', '42501', '명령 밖 INSERT는 소유자도 거절');
-- 로그인 없음 · 비활성 · 학생 계정 · 권한 없는 역할.
select mt.throws('select mt.cmd(null, ''intake'', ''{}''::jsonb)', 'forbidden', '익명 거절');
select mt.cmd_throws(mt.id(29), 'intake', '{}'::jsonb, null, 'forbidden', '비활성 계정 거절');
select mt.cmd_throws(mt.id(20), 'intake', '{}'::jsonb, null, 'forbidden', '학생 계정 거절');
select mt.cmd_throws(mt.id(28), 'intake', '{}'::jsonb, null, 'forbidden', '기본 none 역할(열람) 거절');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(28), 'select public.makeup_list_cases()'), 'forbidden', 'MU-077 권한 없는 역할은 목록·집계도 거절');

-- 역할별: 접수는 강사(담당 반)·데스크(개인 예외 full) 가능, 승인은 원장·관리자만.
create temp table c as select (mt.cmd(mt.id(25), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51), 'original_date', mt.d(-3))) ->> 'id')::uuid as id;
select mt.eq((select owner_id from public.makeup_cases where id = (select id from c)), mt.id(25), '강사 접수 → 본인이 담당');
select mt.cmd_throws(mt.id(25), 'intake', jsonb_build_object('student_id', mt.id(64), 'original_class_id', mt.id(52), 'original_date', mt.d(-3)), null, 'forbidden', 'MU-036 타반 강사 접수 거절');
select mt.cmd_throws(mt.id(26), 'approve', jsonb_build_object('case_id', (select id from c), 'target_minutes', 60), 1, 'forbidden', '강사 승인 거절');
select mt.cmd_throws(mt.id(24), 'approve', jsonb_build_object('case_id', (select id from c), 'target_minutes', 60), 1, 'forbidden', '매니저 승인 거절(운영만)');
select mt.cmd_throws(mt.id(27), 'approve', jsonb_build_object('case_id', (select id from c), 'target_minutes', 60), 1, 'forbidden', 'MU-039 데스크 승인 거절');
select mt.ok((mt.cmd(mt.id(27), 'assign', jsonb_build_object('case_id', (select id from c), 'owner_id', mt.id(25)), mt.rev('makeup_cases', (select id from c))) ->> 'id') is not null, '데스크(개인 예외 full) 담당 지정 가능');
select mt.cmd_throws(mt.id(25), 'assign', jsonb_build_object('case_id', (select id from c), 'owner_id', mt.id(26)), mt.rev('makeup_cases', (select id from c)), 'forbidden', '강사 담당 지정 거절');
select mt.cmd_throws(mt.id(22), 'configure', '{"mode":"off"}'::jsonb, null, 'forbidden', '관리자 설정 변경 거절(원장만)');
-- MU-036 범위: 타반 강사는 상세·목록·집계에서 못 본다.
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(26), format('select public.makeup_case_detail(%L)', (select id from c))), 'not_found', 'MU-036 타반 강사 상세 거절(없음과 같은 오류)');
select mt.eq((mt.run(mt.id(26), 'select public.makeup_list_cases()') ->> 'total')::int, 0, 'MU-036 타반 강사 목록 0건');
select mt.eq((mt.run(mt.id(26), 'select public.makeup_list_cases()') -> 'counts' ->> 'active')::int, 0, 'MU-077 타반 강사 집계도 0');
select mt.eq((mt.run(mt.id(25), 'select public.makeup_list_cases()') ->> 'total')::int, 1, '담당 강사 목록 1건');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases()') ->> 'total')::int, 1, '관리자 목록 1건');
-- MU-023 다른 지점: 다른 학원 원장은 이 건을 못 보고 못 건드린다. 다른 학원 학생·반 결합도 거절.
select mt.cmd(mt.id(31), 'configure', '{"mode":"on"}'::jsonb);
select mt.eq((mt.run(mt.id(31), 'select public.makeup_list_cases()') ->> 'total')::int, 0, 'MU-023 다른 지점 목록 0건');
select mt.cmd_throws(mt.id(31), 'approve', jsonb_build_object('case_id', (select id from c), 'target_minutes', 60), 2, 'not_found', 'MU-023 다른 지점 케이스 승인 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(69), 'original_class_id', mt.id(51), 'original_date', mt.d(-3)), null, 'not_found', 'MU-023 다른 지점 학생 접수 거절');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(59), 'original_date', mt.d(-3)), null, 'not_found', 'MU-023 다른 지점 반 접수 거절');
-- 역할 override는 지금 값으로 즉시 반영된다(읽기 전용이면 쓰기 거절, 읽기는 담당 범위 유지).
update public.tenant_settings set data = jsonb_set(data, '{permissions,overrides}', '[{"role":"teacher","menu":"makeups","access":"readonly"}]') where tenant_id = mt.id(11);
select mt.cmd_throws(mt.id(25), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-3)), null, 'forbidden', '읽기 전용 강사 쓰기 거절');
select mt.eq((mt.run(mt.id(25), 'select public.makeup_list_cases()') ->> 'total')::int, 1, '읽기 전용 강사는 담당 범위만 읽는다');
select mt.eq((mt.run(mt.id(26), 'select public.makeup_list_cases()') ->> 'total')::int, 0, '읽기 전용 타반 강사 0건');
update public.tenant_settings set data = jsonb_set(data, '{permissions,overrides}', '[{"role":"teacher","menu":"makeups","access":"none"},{"role":"master","menu":"makeups","access":"none"}]') where tenant_id = mt.id(11);
select mt.cmd_throws(mt.id(25), 'intake', '{}'::jsonb, null, 'forbidden', '역할 override none → 즉시 거절');
select mt.eq((mt.run(mt.id(21), 'select public.makeup_list_cases()') ->> 'total')::int, 1, '원장은 override로 잠기지 않는다');
select count(*) as passed from mt.passed;
rollback;
