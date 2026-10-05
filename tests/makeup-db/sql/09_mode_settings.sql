-- 운영 모드와 설정 가드: off(기본) · on · draining, 직접 변경 거절 (MU-058 · MU-X14)
begin;
select mt.seed();
select mt.login(null);
-- 기본은 꺼짐: 명령·읽기 모두 예외로 거절(빈 목록으로 답하지 않는다). 기존 예약 표는 종전 그대로 쓴다.
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(51), 'original_date', mt.d(-3)), null, 'mode_off', '꺼짐: 접수 거절');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_list_cases()'), 'mode_off', 'MU-X14 꺼짐: 목록은 빈 배열이 아니라 오류');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_list_participants()'), 'mode_off', '꺼짐: 참여 명단도 오류');
select mt.throws(format('select mt.run(%L::uuid, %L)', mt.id(22), 'select public.makeup_list_reconciliation()'), 'mode_off', '꺼짐: 대사 목록도 오류');
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(101), mt.id(11), mt.id(61), mt.id(51), mt.d(-6), mt.d(3), '10:00', '11:00');
delete from public.makeup_reservations where id = mt.id(101);
select mt.eq((select count(*)::int from public.makeup_reservations), 0, 'MU-X14 꺼진 지점의 기존 예약 표는 종전대로 쓰고 지운다');

-- 켜기는 원장의 configure 명령으로만. 값 검증.
select mt.cmd_throws(mt.id(21), 'configure', '{"mode":"sometimes"}'::jsonb, null, 'invalid', '알 수 없는 운영 상태 거절');
select mt.cmd_throws(mt.id(21), 'configure', '{"pilot_subjects":["Math!"]}'::jsonb, null, 'invalid', '과목 키 형식 검증');
create temp table cfg as select mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb) as r;
select mt.eq((select r -> 'settings' ->> 'mode' from cfg), 'on', '원장이 켠다');
select mt.eq((select data -> 'makeups' from public.tenant_settings where tenant_id = mt.id(11)), '{"mode":"on","allowAdditional":false,"pilotSubjects":["math"]}'::jsonb, '설정 정본 = tenant_settings.data.makeups(camelCase)');
select mt.ok((select data ? 'permissions' from public.tenant_settings where tenant_id = mt.id(11)), '다른 설정 섹션은 보존');
select mt.eq((select count(*)::int from public.audit_logs where action = 'makeup_configure'), 1, '설정 변경 감사로그');

-- 직접 변경은 원장도·관리자 클라이언트도 거절. 같은 값으로 다시 쓰는 다른 섹션 저장은 통과.
select mt.login(mt.id(21));
set local role authenticated;
select mt.throws('update public.tenant_settings set data = jsonb_set(data, ''{makeups,mode}'', ''"off"'') where tenant_id = public.auth_tenant_id()', '42501', '원장의 직접 PATCH로 모드 변경 거절');
update public.tenant_settings set data = jsonb_set(data, '{profile}', '{"name":"가상학원 가"}') where tenant_id = public.auth_tenant_id();
reset role;
select mt.login(null);
select mt.eq((select data -> 'profile' ->> 'name' from public.tenant_settings where tenant_id = mt.id(11)), '가상학원 가', '다른 섹션 저장(같은 makeups 값)은 통과');
set local role service_role;
select mt.throws('update public.tenant_settings set data = jsonb_set(data, ''{makeups,allowAdditional}'', ''true'') where tenant_id = mt.id(11)', '42501', '관리자 클라이언트의 직접 변경 거절');
select mt.throws('insert into public.tenant_settings (tenant_id, data) values (mt.id(11), ''{"makeups":{"mode":"off"}}'') on conflict (tenant_id) do update set data = excluded.data', '42501', 'upsert로 통째 덮어쓰기 거절');
reset role;
select mt.throws('delete from public.tenant_settings where tenant_id = mt.id(11)', '42501', '켜진 설정 행 삭제 거절');
insert into public.tenants (id, slug, name) values (mt.id(13), 'makeup-c', '가상학원 다');
select mt.throws('insert into public.tenant_settings (tenant_id, data) values (mt.id(13), ''{"makeups":{"mode":"on"}}'')', '42501', '새 설정 행에 켜진 값 직접 삽입 거절');
insert into public.tenant_settings (tenant_id, data) values (mt.id(13), '{}');
select mt.eq((select count(*)::int from public.tenant_settings where tenant_id = mt.id(13)), 1, '보강 설정 없는 새 학원 설정 행은 통과');

-- 업무를 만들어 둔다: 진행 중 1건(예약 있음) + 접수만 한 1건.
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 110) as a1;
create temp table p as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
create temp table c2 as select (mt.cmd(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(62), 'original_class_id', mt.id(51), 'original_date', mt.d(-6))) ->> 'id')::uuid as id;
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(102), mt.id(11), mt.id(63), mt.id(51), mt.d(-6), mt.d(4), '10:00', '11:00');

-- 열린 업무가 있으면 끌 수 없다 → 정리 상태(draining)로.
select mt.cmd_throws(mt.id(21), 'configure', '{"mode":"off"}'::jsonb, null, 'conflict', 'MU-058 열린 업무가 있으면 끌 수 없다');
select mt.cmd(mt.id(21), 'configure', '{"mode":"draining"}'::jsonb);
-- draining: 새 접수·새 일정·기존 예약 연결은 멈추고, 열린 업무는 이어 간다.
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(63), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), null, 'mode_draining', 'MU-X14 정리 중: 새 접수 거절');
select mt.throws(format('select mt.reserved(%L::uuid, %L::uuid, %L::uuid, %L::date, array[''1''], 10)', mt.id(22), mt.id(61), (select a1 from k), mt.d(5)), 'mode_draining', '정리 중: 새 일정 거절');
select mt.cmd_throws(mt.id(22), 'link_legacy', jsonb_build_object('source_id', mt.id(102)), null, 'mode_draining', '정리 중: 기존 예약 새 연결 거절');
select mt.eq((mt.run(mt.id(22), 'select public.makeup_list_cases()') ->> 'mode'), 'draining', '정리 중: 목록은 읽힌다(운영 상태 표시)');
select mt.fulfill((select id from p), 110, jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110)));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select a1 from k)), 'closed:completed', 'MU-X14 정리 중에도 열린 업무는 끝까지 처리된다');
select mt.cmd_throws(mt.id(21), 'configure', '{"mode":"off"}'::jsonb, null, 'conflict', '접수만 한 건이 남아 있어도 끌 수 없다');
select mt.cmd(mt.id(22), 'deny', jsonb_build_object('case_id', (select id from c2), 'reason', '합성 거절'), mt.rev('makeup_cases', (select id from c2)));
-- 열린 대사(월 경계면 수납 확인이 하나 열려 있다)도 끄기 전에 처리한다.
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', r.id, 'note', '합성 확인'), r.revision)
  from public.makeup_reconciliation r where r.state = 'open';
-- 열린 업무 0건 → 꺼짐. 이력은 그대로 남는다(원본 삭제·drop 없음).
select mt.cmd(mt.id(21), 'configure', '{"mode":"off"}'::jsonb);
select mt.eq((select data -> 'makeups' ->> 'mode' from public.tenant_settings where tenant_id = mt.id(11)), 'off', 'MU-058 열린 업무 0건이면 꺼진다');
select mt.eq((select count(*)::int from public.makeup_cases) || ':' || (select count(*)::int from public.makeup_recognitions) || ':' || (select count(*) > 0 from public.makeup_events)::text, '2:1:true', 'MU-058 꺼진 뒤에도 이력 보존');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(63), 'original_class_id', mt.id(51), 'original_date', mt.d(-6)), null, 'mode_off', 'MU-058 꺼진 뒤 신규 쓰기 중지');
select mt.eq((select count(*)::int from public.makeup_events where entity_type = 'settings'), 3, '설정 변경 이력 3건(on · draining · off)');
-- 같은 설정 요청의 재시도는 저장된 결과를 돌려준다(꺼져 있어도 configure는 통과).
select mt.eq((mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb) -> 'settings' ->> 'mode'), 'on', '다시 켜기');
select count(*) as passed from mt.passed;
rollback;
