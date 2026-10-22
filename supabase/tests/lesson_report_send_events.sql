-- 수업보고서 발송 이력(0392a) — 합성 지점만. 보고서·이력·사용자 전부 롤백한다(DDL 없음 — 행 잠금은 합성 행뿐).
-- 0392a를 적용한 DB에서 begin부터 rollback까지 한 번에(pgtap 필요). 운영 DB에서는 원장 승인 뒤에만.
begin;
create extension if not exists pgtap;
select set_config('request.jwt.claims', '{}', true);
select no_plan();

-- ── 표·권한 — 서버 전용 · 추가만 ──────────────────────────────────────────────
select has_table('public', 'lesson_report_send_events', '발송 이력 표가 있다');
select ok((select relrowsecurity from pg_class where oid = 'public.lesson_report_send_events'::regclass), 'RLS 켜짐');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'lesson_report_send_events'),
  0, '정책 0개 — 서버 전용');
select ok(not has_table_privilege('anon', 'public.lesson_report_send_events', 'select'), '공개 키는 못 읽는다');
select ok(not has_table_privilege('authenticated', 'public.lesson_report_send_events', 'select'), '로그인 사용자도 직접 못 읽는다');
select ok(not has_table_privilege('authenticated', 'public.lesson_report_send_events', 'insert'), '로그인 사용자는 못 넣는다');
select ok(not has_table_privilege('authenticated', 'public.lesson_report_send_events', 'update'), '로그인 사용자는 못 고친다');
select ok(not has_table_privilege('authenticated', 'public.lesson_report_send_events', 'delete'), '로그인 사용자는 못 지운다');
select ok(has_table_privilege('service_role', 'public.lesson_report_send_events', 'select'), '서버 키는 읽는다');
select ok(not has_table_privilege('service_role', 'public.lesson_report_send_events', 'insert'), '서버 키도 못 넣는다(트리거만)');
select ok(not has_table_privilege('service_role', 'public.lesson_report_send_events', 'update'), '서버 키도 못 고친다');
select ok(not has_table_privilege('service_role', 'public.lesson_report_send_events', 'delete'), '서버 키도 못 지운다');
select ok(not has_function_privilege('authenticated', 'lesson_report_send_private.snapshot(jsonb,uuid,boolean)', 'execute'),
  '사본 함수는 앱이 못 부른다');
select ok(not has_function_privilege('authenticated', 'lesson_report_send_private.capture()', 'execute'),
  '기록 함수는 앱이 못 부른다');
select ok(not has_sequence_privilege('authenticated', pg_get_serial_sequence('public.lesson_report_send_events', 'id'), 'update'),
  '번호 시퀀스도 앱이 못 건드린다');
select ok(not has_sequence_privilege('service_role', pg_get_serial_sequence('public.lesson_report_send_events', 'id'), 'update'),
  '번호 시퀀스는 서버 키도 못 건드린다');

-- ── 합성 자료 ────────────────────────────────────────────────────────────────
insert into public.tenants(id, slug, name) values
 ('10000000-0000-4000-8000-000000000a01', 'send-events-test-a', 'Send events A'),
 ('10000000-0000-4000-8000-000000000a02', 'send-events-test-b', 'Send events B');
insert into public.users(id, tenant_id, email, display_name, system_role, status) values
 ('20000000-0000-4000-8000-000000000a01', '10000000-0000-4000-8000-000000000a01', 'send-teacher@test.invalid',
  '보내는 선생님', 'teacher', 'active');
insert into public.classes(id, tenant_id, class_name, subject, teacher_id) values
 ('30000000-0000-4000-8000-000000000a01', '10000000-0000-4000-8000-000000000a01', '발송 수학반', 'math',
  '20000000-0000-4000-8000-000000000a01');
insert into public.students(id, tenant_id, name, status, enrolled_at, school, grade) values
 ('40000000-0000-4000-8000-000000000a01', '10000000-0000-4000-8000-000000000a01', '발송학생', 'enrolled',
  '2020-01-01', '침산중', '중2'),
 ('40000000-0000-4000-8000-000000000a02', '10000000-0000-4000-8000-000000000a02', '다른지점학생', 'enrolled',
  '2020-01-01', null, null);
insert into public.lesson_reports(id, tenant_id, student_id, report_date, subject, class_id, teacher_name, textbook,
  progress, daily_test, notes, attachments) values
 ('60000000-0000-4000-8000-000000000a01', '10000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000a01',
  '2026-10-20', 'math', '30000000-0000-4000-8000-000000000a01', '보내는 선생님', '개념원리', '1단원', '10/10', '첫 멘트',
  '[{"path":"t/a.jpg","name":"a.jpg","size":1}]'),
 ('60000000-0000-4000-8000-000000000a02', '10000000-0000-4000-8000-000000000a01', '40000000-0000-4000-8000-000000000a01',
  '2026-10-21', 'math', null, '보내는 선생님', null, '2단원', null, '발송 안 한 보고서', '[]');
create temporary table t_tok(k text primary key, v uuid);
insert into t_tok select 'first', share_token from public.lesson_reports where id = '60000000-0000-4000-8000-000000000a01';
create function pg_temp.n(p_event text) returns int language sql as $$
  select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and event = p_event
$$;
create function pg_temp.last_ev() returns public.lesson_report_send_events language sql as $$
  select * from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' order by id desc limit 1
$$;

select is((select count(*)::int from public.lesson_report_send_events
  where tenant_id = '10000000-0000-4000-8000-000000000a01'), 0, '발송 상태 없는 보고서 저장은 이력을 안 남긴다');

-- ── ① 선생님이 발송 요청(로그인 사용자 · RLS 통과) → requested + 요청자 ─────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000a01","role":"authenticated"}', true);
update public.lesson_reports set classnote_status = 'queued', classnote_queued_at = now(), classnote_retry_count = 0
 where id = '60000000-0000-4000-8000-000000000a01';
reset role;
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.n('requested'), 1, '발송 요청 = requested 한 줄');
select is((pg_temp.last_ev()).actor_id, '20000000-0000-4000-8000-000000000a01'::uuid, '요청한 사람이 남는다');
select is((pg_temp.last_ev()).actor_name, '보내는 선생님', '요청한 사람 이름도 남는다');
select is((pg_temp.last_ev()).snapshot, null::jsonb, '요청 줄에는 사본이 없다');
select is((pg_temp.last_ev()).db_role, 'authenticated', '로그인 화면에서 바꾼 줄');

-- 대기 중에 다시 누름(요청 시각만 바뀜) → requested 한 줄 더
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000a01","role":"authenticated"}', true);
update public.lesson_reports set classnote_status = 'queued', classnote_queued_at = now() + interval '1 minute'
 where id = '60000000-0000-4000-8000-000000000a01';
reset role;
select set_config('request.jwt.claims', '{}', true);
select is(pg_temp.n('requested'), 2, '대기 중에 다시 누른 것도 requested');

-- ── ② 연동 PC가 집고(processing = 캡처 직전 사본) 게시 중에 고쳐도 사본은 집은 순간 것 ──
update public.lesson_reports set classnote_status = 'processing', classnote_processing_at = now()
 where id = '60000000-0000-4000-8000-000000000a01';
select is(pg_temp.n('claimed'), 1, '연동 PC가 집은 순간 = claimed');
select is((pg_temp.last_ev()).snapshot ->> 'notes', '첫 멘트', '집은 순간의 사본');
update public.lesson_reports set notes = '게시 중 고친 멘트' where id = '60000000-0000-4000-8000-000000000a01';
do $$
begin
  -- 연동 앱 전용 역할이 있으면 그 역할로(운영과 같은 길) — 없는 DB에서는 그대로 쓴다.
  if exists (select 1 from pg_roles where rolname = 'eywa_sync_agent') then
    execute 'set local role eywa_sync_agent';
    perform set_config('eywa.agent_tenant', '10000000-0000-4000-8000-000000000a01', true);
  end if;
  update public.lesson_reports
     set classnote_status = 'success', classnote_sent_at = '2026-10-20 18:00+09', classnote_error = null
   where id = '60000000-0000-4000-8000-000000000a01';
  execute 'reset role';
end
$$;
select is(pg_temp.n('sent'), 1, '게시 성공 = sent 한 줄');
select is((pg_temp.last_ev()).sent_at, '2026-10-20 18:00+09'::timestamptz, '발송 시각');
select is((pg_temp.last_ev()).requested_by, '20000000-0000-4000-8000-000000000a01'::uuid, '발송 줄에 요청자');
select is((pg_temp.last_ev()).actor_id, null::uuid, '연동 PC는 로그인 사용자가 아니다');
select ok((pg_temp.last_ev()).db_role in ('eywa_sync_agent', session_user::text), '연동 PC 역할(없는 DB면 직접 쓴 역할)');
select is((pg_temp.last_ev()).snapshot ->> 'notes', '첫 멘트', '발송 사본 = 집은 순간 멘트(게시 중 고친 것 아님)');
select is((pg_temp.last_ev()).snapshot_at, (select at from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and event = 'claimed'), '사본을 뜬 시각 = 집은 시각');
select is((pg_temp.last_ev()).snapshot ->> 'progress', '1단원', '사본 = 진도');
select is((pg_temp.last_ev()).snapshot ->> 'daily_test', '10/10', '사본 = 일일테스트');
select is(jsonb_array_length((pg_temp.last_ev()).snapshot -> 'attachments'), 1, '사본 = 첨부 목록');
select is((pg_temp.last_ev()).snapshot -> 'student' ->> 'name', '발송학생', '사본 = 학생 이름');
select is((pg_temp.last_ev()).snapshot -> 'classes' ->> '30000000-0000-4000-8000-000000000a01', '발송 수학반', '사본 = 반 이름');
select ok((pg_temp.last_ev()).snapshot ? 'card_settings', '사본 = 카드 표시 설정 칸');
select is((pg_temp.last_ev()).share_token, (select v from t_tok where k = 'first'), '그때 공유 토큰');

-- ── ③ 발송 뒤 내용 수정 → 이력 그대로 ─────────────────────────────────────────
update public.lesson_reports set notes = '고친 멘트' where id = '60000000-0000-4000-8000-000000000a01';
select is((select snapshot ->> 'notes' from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and event = 'sent'), '첫 멘트', '발송 뒤 수정해도 사본은 그대로');

-- ── ④ 공유 링크 재발급(표시 지움) → cleared가 지워지기 직전 값을 남긴다 ─────────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000a01","role":"authenticated"}', true);
update public.lesson_reports set share_token = gen_random_uuid(), revoked_at = null, revoked_by = null,
  classnote_status = null, classnote_error = null, classnote_queued_at = null, classnote_processing_at = null,
  classnote_sent_at = null, classnote_retry_count = 0
 where id = '60000000-0000-4000-8000-000000000a01';
reset role;
select set_config('request.jwt.claims', '{}', true);
select is((pg_temp.last_ev()).event, 'cleared', '표시 지움 = cleared');
select is((pg_temp.last_ev()).from_status, 'success', '지우기 전 상태');
select is((pg_temp.last_ev()).sent_at, '2026-10-20 18:00+09'::timestamptz, '지워진 발송 시각이 남는다');
select is((pg_temp.last_ev()).share_token, (select v from t_tok where k = 'first'), '지워진(옛) 공유 토큰이 남는다');
select is((pg_temp.last_ev()).snapshot ->> 'notes', '고친 멘트', '지우기 직전 내용이 남는다');
select is((pg_temp.last_ev()).actor_id, '20000000-0000-4000-8000-000000000a01'::uuid, '지운 사람');
select is((select classnote_sent_at from public.lesson_reports where id = '60000000-0000-4000-8000-000000000a01'),
  null::timestamptz, '원래 쓰기(표시 지움)는 그대로 된다');

-- ── ⑤ 재발송 → 발송 줄 둘 · 첫 사본 그대로 ─────────────────────────────────────
update public.lesson_reports set classnote_status = 'queued', classnote_queued_at = now()
 where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing', classnote_processing_at = now()
 where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'success', classnote_sent_at = '2026-10-21 18:00+09'
 where id = '60000000-0000-4000-8000-000000000a01';
select is(pg_temp.n('sent'), 2, '두 번 나갔으면 발송 줄 둘');
select is((pg_temp.last_ev()).snapshot ->> 'notes', '고친 멘트', '두 번째 사본 = 고친 멘트');
select is((select snapshot ->> 'notes' from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and event = 'sent' order by id limit 1), '첫 멘트',
  '첫 발송 사본은 그대로');
select is((pg_temp.last_ev()).requested_by, null::uuid, '마지막 요청이 서버 경로(로그인 없음)면 요청자 없음');

-- ── ⑥ 회수 → recall_requested · recalled(집는 순간 recalling은 남기지 않는다) ────
update public.lesson_reports set classnote_status = 'recall_requested' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'recalling' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'recalled' where id = '60000000-0000-4000-8000-000000000a01';
select is(pg_temp.n('recall_requested'), 1, '회수 요청');
select is(pg_temp.n('recalled'), 1, '회수 완료');
select is((pg_temp.last_ev()).sent_at, '2026-10-21 18:00+09'::timestamptz, '회수한 글의 발송 시각');
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and to_status = 'recalling'), 0, 'recalling은 남기지 않는다');

-- ── ⑦ 재시도·실패·보류 ───────────────────────────────────────────────────────
update public.lesson_reports set classnote_status = null, classnote_sent_at = null
 where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued', classnote_retry_count = 1, classnote_error = '응답 없음'
 where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).event, 'retry', '연동 PC 재시도 = retry');
select is((pg_temp.last_ev()).error, '응답 없음', '재시도 사유');
update public.lesson_reports set classnote_status = 'failed', classnote_error = '해당 학생 없음'
 where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).event, 'failed', '최종 실패 = failed');
select ok((pg_temp.last_ev()).snapshot is not null, '실패 줄에도 사본(일부 게시됐을 수 있다)');
update public.lesson_reports set classnote_status = 'too_old' where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).event, 'held', '보류 = held');

-- 같은 자리를 도는 반복(비상 정지·시험 모드) — 처음 한 번만
update public.lesson_reports set classnote_status = 'queued', classnote_retry_count = 0, classnote_error = null
 where id = '60000000-0000-4000-8000-000000000a01';
create temporary table t_loop as select max(id) as id from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued', classnote_error = '반별 발송 멈춤' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued', classnote_error = '반별 발송 멈춤' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued', classnote_error = '반별 발송 멈춤' where id = '60000000-0000-4000-8000-000000000a01';
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and id > (select id from t_loop)), 2,
  '같은 반복은 claimed·retry 한 번씩만');
-- 15분 넘게 쥐고 있다 되돌린 멈춤 복구 · 로그인 사용자가 되돌린 것은 같은 사유여도 남긴다(그 사이 게시됐을 수 있다)
update public.lesson_reports set classnote_status = 'processing', classnote_processing_at = now() - interval '20 minutes'
 where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued', classnote_error = '반별 발송 멈춤' where id = '60000000-0000-4000-8000-000000000a01';
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and id > (select id from t_loop) and event = 'retry'), 2,
  '오래 쥐고 있다 되돌린 재시도는 남긴다');
update public.lesson_reports set classnote_status = 'processing', classnote_processing_at = now()
 where id = '60000000-0000-4000-8000-000000000a01';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000a01","role":"authenticated"}', true);
update public.lesson_reports set classnote_status = 'queued', classnote_error = '반별 발송 멈춤' where id = '60000000-0000-4000-8000-000000000a01';
reset role;
select set_config('request.jwt.claims', '{}', true);
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01' and id > (select id from t_loop) and event = 'retry'), 3,
  '사람이 되돌린 것은 늘 남긴다');

-- 실패 줄은 옛 발송 시각을 물려받지 않는다 · 실패 처리하며 새로 찍은 시각(교차 확인 이상)만 싣는다
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'success', classnote_sent_at = '2026-10-22 18:00+09', classnote_error = null
 where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'queued' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'failed', classnote_error = '해당 학생 없음'
 where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).sent_at, null::timestamptz, '실패 줄은 행에 남은 옛 발송 시각을 싣지 않는다');
update public.lesson_reports set classnote_status = 'queued' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'processing' where id = '60000000-0000-4000-8000-000000000a01';
update public.lesson_reports set classnote_status = 'failed', classnote_sent_at = '2026-10-22 19:00+09', classnote_error = '교차 확인 이상'
 where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).sent_at, '2026-10-22 19:00+09'::timestamptz, '실패 처리하며 찍은 발송 시각(게시됨)은 싣는다');
update public.lesson_reports set classnote_status = 'success' where id = '60000000-0000-4000-8000-000000000a01';
select is((pg_temp.last_ev()).event, 'other', '발송 시각 없이 상태만 success로 되돌린 것은 새 발송이 아니다');

-- ── ⑧ 이력은 고치거나 지울 수 없다 ────────────────────────────────────────────
select throws_ok($q$update public.lesson_report_send_events set note = 'x'
  where report_id = '60000000-0000-4000-8000-000000000a01'$q$, '42501', null, '이력 수정 거절');
select throws_ok($q$delete from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01'$q$, '42501', null, '이력 삭제 거절');

-- ── ⑨ 보고서 삭제 — 발송 흔적이 있으면 deleted + 이력은 남는다 · 없으면 안 남긴다 ─
create temporary table t_cnt as select count(*)::int as n from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01';
delete from public.lesson_reports where id = '60000000-0000-4000-8000-000000000a01';
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a01'), (select n + 1 from t_cnt), '보고서를 지워도 이력이 남는다(+deleted)');
select is((pg_temp.last_ev()).event, 'deleted', '삭제 = deleted');
select is((pg_temp.last_ev()).snapshot ->> 'notes', '고친 멘트', '지운 보고서의 마지막 내용');
delete from public.lesson_reports where id = '60000000-0000-4000-8000-000000000a02';
select is((select count(*)::int from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a02'), 0, '발송 흔적 없는 보고서 삭제는 안 남긴다');

-- ── ⑩ 처음부터 발송 상태로 들어온 줄(이관) · 다른 지점 학생은 사본에 안 싣는다 ───
insert into public.lesson_reports(id, tenant_id, student_id, report_date, subject, notes, classnote_status, classnote_sent_at)
values ('60000000-0000-4000-8000-000000000a03', '10000000-0000-4000-8000-000000000a01',
        '40000000-0000-4000-8000-000000000a02', '2026-10-19', 'math', '이관 멘트', 'success', '2026-10-19 18:00+09');
select is((select event from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a03'), 'sent', '발송 상태로 들어온 줄 = sent');
select is((select snapshot -> 'student' from public.lesson_report_send_events
  where report_id = '60000000-0000-4000-8000-000000000a03'), 'null'::jsonb, '다른 지점 학생 이름은 사본에 안 싣는다');

select * from finish();
rollback;
