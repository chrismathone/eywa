-- 첫 운영 범위의 서버 강제 · 기능 목록 가드 · 꺼진 뒤의 연결 보호 (보완 6 — MU-006·058·073·076 · MU-X06·X14)
begin;
select mt.seed();
select mt.login(null);
create function pg_temp.disabled() returns jsonb language sql as $$ select data #> '{modules,disabled}' from public.tenant_settings where tenant_id = mt.id(11) $$;
create function pg_temp.set_disabled(p jsonb) returns void language sql as $$
  update public.tenant_settings set data = jsonb_set(jsonb_set(data, '{modules}', coalesce(data -> 'modules', '{}'::jsonb)), '{modules,disabled}', p) where tenant_id = mt.id(11) $$;

-- ① 꺼져 있을 때는 기능 목록에서 보강관리를 꺼 둘 수 있다(열린 업무가 없다).
select pg_temp.set_disabled('["makeups","shuttle"]');
select mt.eq(pg_temp.disabled(), '["makeups","shuttle"]'::jsonb, '꺼진 지점은 기능 목록에서 꺼 둘 수 있다');
-- ② 켜는 명령이 기능 목록에서 보강관리를 뺀다(다른 기능은 그대로) — 켰는데 메뉴가 없는 상태를 만들지 않는다.
select mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb);
select mt.eq(pg_temp.disabled(), '["shuttle"]'::jsonb, 'MU-X14 켜면 기능 목록의 꺼짐 표시가 함께 풀린다(다른 기능 보존)');
-- ③ 켜져 있는 동안 기능 목록에 다시 넣어 감추는 것은 누구의 직접 쓰기든 거절(열린 업무가 메뉴째 숨지 않게).
select mt.throws($$select pg_temp.set_disabled('["shuttle","makeups"]')$$, '42501', '켜진 동안 기능 목록에서 끄기 거절');
set local role service_role;
select mt.throws($$update public.tenant_settings set data = jsonb_set(data, '{modules,disabled}', '["makeups"]') where tenant_id = mt.id(11)$$, '42501', '관리자 클라이언트의 직접 쓰기도 거절');
reset role;
select pg_temp.set_disabled('["shuttle","inventory"]');
select mt.eq(pg_temp.disabled(), '["shuttle","inventory"]'::jsonb, '다른 기능을 끄는 저장은 그대로 통과');

-- ④ 유효 설정은 저장된 값이 무엇이든 첫 운영 범위를 넘지 못한다(옛 값·직접 넣은 값을 흉내 낸다 — 검증 전용 표식).
select mt.as_command();
update public.tenant_settings set data = jsonb_set(data, '{makeups}', '{"mode":"on","allowAdditional":true,"pilotSubjects":["math","english"]}') where tenant_id = mt.id(11);
select mt.end_command();
select mt.eq(makeup_private.settings(mt.id(11)), '{"mode":"on","allowAdditional":false,"pilotSubjects":["math"]}'::jsonb, 'MU-006·X06 유효 설정은 수학만 · 추가 지도 꺼짐');
select mt.cmd_throws(mt.id(22), 'intake', jsonb_build_object('student_id', mt.id(61), 'original_class_id', mt.id(53), 'original_date', mt.d(-5)), null, 'invalid', 'MU-006 저장값에 영어가 있어도 영어 접수는 거절');
select mt.eq((mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb) -> 'settings'), '{"mode":"on","allowAdditional":false,"pilotSubjects":["math"]}'::jsonb, '다음 설정 저장이 저장값도 범위 안으로 정리한다');
select mt.eq((select data -> 'makeups' from public.tenant_settings where tenant_id = mt.id(11)), '{"mode":"on","allowAdditional":false,"pilotSubjects":["math"]}'::jsonb, '정리된 값이 저장됐다');
-- 범위를 넓히는 요청은 한꺼번에 보내도 전부 거절이고 아무것도 바뀌지 않는다.
select mt.cmd_throws(mt.id(21), 'configure', '{"mode":"draining","pilot_subjects":["math","science"],"allow_additional":true}'::jsonb, null, 'invalid', '범위를 넓히는 설정은 통째로 거절');
select mt.eq((select data -> 'makeups' ->> 'mode' from public.tenant_settings where tenant_id = mt.id(11)), 'on', '거절된 요청은 운영 상태도 바꾸지 않는다');
select mt.cmd_throws(mt.id(22), 'configure', '{"mode":"off"}'::jsonb, null, 'forbidden', '설정은 원장만');

-- ⑤ 업무 한 건을 끝까지 처리하고 끈다. 정리 중에도 기능 목록에서 끄기는 거절이다.
create temp table k as select mt.approved_case(mt.id(61), mt.id(51), mt.d(-6), 110) as a1;
create temp table p as select mt.reserved(mt.id(22), mt.id(61), (select a1 from k), mt.d(0), array['1','2'], 110) as id;
create temp table resv as select m.legacy_id as id from public.makeup_legacy_maps m where m.participant_id = (select id from p) and m.state = 'active';
select mt.cmd(mt.id(21), 'configure', '{"mode":"draining"}'::jsonb);
select mt.throws($$select pg_temp.set_disabled('["makeups"]')$$, '42501', 'MU-058 정리 중에도 기능 목록에서 끄기 거절(열린 업무가 남아 있다)');
select mt.fulfill((select id from p), 110, jsonb_build_array(jsonb_build_object('case_id', (select a1 from k), 'minutes', 110)));
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', r.id, 'note', '합성 확인'), r.revision)
  from public.makeup_reconciliation r where r.state = 'open';
select mt.cmd(mt.id(21), 'configure', '{"mode":"off"}'::jsonb);
select mt.eq((select data -> 'makeups' ->> 'mode' from public.tenant_settings where tenant_id = mt.id(11)), 'off', '열린 업무 0건 → 꺼짐');
-- ⑥ 꺼진 뒤에도 원장에 연결된 예약 행의 보호는 그대로다(연결을 없던 일로 만들지 않는다).
select mt.eq((select count(*)::int from public.makeup_legacy_maps where legacy_id = (select id from resv) and state = 'active'), 1, '꺼진 뒤에도 연결은 살아 있다');
select mt.throws(format('delete from public.makeup_reservations where id = %L', (select id from resv)), 'P0001', 'MU-073 꺼진 뒤에도 연결된 예약 삭제 거절');
select mt.throws(format('update public.makeup_reservations set makeup_date = makeup_date + 1 where id = %L', (select id from resv)), 'P0001', 'MU-073 꺼진 뒤에도 연결된 예약의 날짜 변경 거절');
insert into public.makeup_reservations (id, tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end)
  values (mt.id(109), mt.id(11), mt.id(62), mt.id(51), mt.d(-6), mt.d(3), '10:00', '11:00');
delete from public.makeup_reservations where id = mt.id(109);
select mt.eq((select count(*)::int from public.makeup_reservations where id = mt.id(109)), 0, '연결되지 않은 예약은 종전대로 쓰고 지운다');
-- 꺼진 뒤에는 기능 목록에서 끌 수 있고, 다시 켜면 또 풀린다.
select pg_temp.set_disabled('["makeups"]');
select mt.eq(pg_temp.disabled(), '["makeups"]'::jsonb, '꺼진 뒤에는 기능 목록에서 끌 수 있다');
select mt.cmd(mt.id(21), 'configure', '{"mode":"on"}'::jsonb);
select mt.eq(pg_temp.disabled(), '[]'::jsonb, '다시 켜면 기능 목록의 꺼짐 표시가 풀린다');
select count(*) as passed from mt.passed;
rollback;
