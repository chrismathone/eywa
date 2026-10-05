-- 수납 확인 대사: 월 경계·분할 실시 때 기준과 예상 소비를 남기고, 청구·출결은 건드리지 않는다 (MU-035 · MU-X11)
begin;
select mt.seed_on();
select mt.login(null);
-- 원수업일: m0 = 이번 달 1일(실시일과 같은 달) · 40일 전(항상 다른 달).
create temp table dt as select date_trunc('month', mt.d(0))::date as m0, mt.d(-40) as old;
insert into public.enrollments (tenant_id, student_id, class_id, start_date) values (mt.id(11), mt.id(64), mt.id(51), mt.d(-200));
create temp table k as select
  mt.approved_case(mt.id(61), mt.id(51), (select m0 from dt), 110) as same_month,
  mt.approved_case(mt.id(62), mt.id(51), (select old from dt), 110) as other_month,
  mt.approved_case(mt.id(63), mt.id(51), (select old from dt), 110) as days_basis,
  mt.approved_case(mt.id(64), mt.id(51), (select m0 from dt), 240) as split;
-- 청구 회차(합성): 학생B = 확정 전(시수 합 기준) · 학생C = 일수로 확정한 호환 행.
insert into public.invoices (id, tenant_id, student_id, period, amount_total, line_items) values
  (mt.id(111), mt.id(11), mt.id(62), to_char(mt.d(0), 'YYYY-MM'), 300000, '[]'::jsonb),
  (mt.id(112), mt.id(11), mt.id(63), to_char(mt.d(0), 'YYYY-MM'), 300000, '[]'::jsonb);
insert into public.invoice_session_terms (id, tenant_id, invoice_id, subject, class_id, confirmed_sessions, quantity_basis) values
  (mt.id(121), mt.id(11), mt.id(111), 'math', mt.id(51), null, 'days'),
  (mt.id(122), mt.id(11), mt.id(112), 'math', mt.id(51), 8, 'days');
create temp table before as select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) as inv,
  (select md5(string_agg(to_jsonb(t)::text, '|' order by t.id)) from public.invoice_session_terms t) as terms from public.invoices i;
create function pg_temp.done(p_student uuid, p_case uuid, p_units numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := mt.reserved(mt.id(22), p_student, p_case, mt.d(0), array['1','2'], 110);
  perform mt.cmd(mt.id(25), 'participation', jsonb_build_object('participant_id', v, 'status', 'present', 'actual_minutes', 110, 'expected_makeup_units', p_units, 'learning_summary', '합성 지도 내용'));
  return v;
end; $$;

-- 같은 달·한 번에 실시 → 수납 확인 대사 없음.
create temp table p1 as select pg_temp.done(mt.id(61), (select same_month from k), 1) as id;
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p1)), 0, '같은 달·단일 실시는 수납 확인 없음');
-- 월 경계 + 확정 전 행 → 기준 = 시수 합, 예상 소비 = 그 칸의 보강 시수.
create temp table p2 as select pg_temp.done(mt.id(62), (select other_month from k), 1) as id;
select mt.eq((select (detail ->> 'quantity_basis') || ':' || (detail ->> 'expected_consumption') || ':' || (detail ->> 'month_changed') || ':' || blocks_close::text
  from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p2)), 'attendance_units:1.0:true:false', 'MU-X11 월 경계 · 시수 합 기준 · 예상 소비 = 보강 시수');
select mt.eq((select detail -> 'original_dates' ->> 0 from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p2)), (select old::text from dt), 'MU-X11 원수업일과 실시일을 함께 적는다');
-- 월 경계 + 일수로 확정한 행 → 기준 = 일수, 그날 정규 수업이 없으면 예상 소비 1일.
create temp table p3 as select pg_temp.done(mt.id(63), (select days_basis from k), 1) as id;
select mt.eq((select (detail ->> 'quantity_basis') || ':' || (detail ->> 'expected_consumption') from public.makeup_reconciliation
  where kind = 'billing_review' and participant_id = (select id from p3)), 'days:1', 'MU-X11 일수 기준 · 예상 소비 1일');
-- 분할 실시(같은 달이어도) → 둘째 실시에서 확인 대사. 청구 회차 행이 없으면 기준 none.
create temp table p4 as select pg_temp.done(mt.id(64), (select split from k), 1) as id;
select mt.eq((select count(*)::int from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p4)), 0, '첫 실시(분할 전)는 확인 없음');
select mt.backdate((select session_id from public.makeup_participants where id = (select id from p4)), mt.d(-1));
create temp table p5 as select pg_temp.done(mt.id(64), (select split from k), 1) as id;
select mt.eq((select (detail ->> 'split') || ':' || (detail ->> 'quantity_basis') || ':' || coalesce(detail ->> 'expected_consumption', 'null')
  from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p5)), 'true:none:null', 'MU-X11 분할 실시 → 수납 확인(청구 회차 행 없음 = none)');

-- MU-035 청구·회차·출결은 그대로다(자동 환불·추가 청구·자동 조정 없음).
select mt.ok((select b.inv = (select md5(string_agg(to_jsonb(i)::text, '|' order by i.id)) from public.invoices i)
  and b.terms = (select md5(string_agg(to_jsonb(t)::text, '|' order by t.id)) from public.invoice_session_terms t) from before b), 'MU-035 청구·회차 행 불변');
select mt.eq((select count(*)::int from public.attendance_records), 0, 'MU-035 출결·시수 행을 만들지 않는다');
-- 수납 확인은 승인 권한자만 해결하고, 종결을 막지 않는다.
create temp table r as select id, revision from public.makeup_reconciliation where kind = 'billing_review' and participant_id = (select id from p2);
select mt.cmd_throws(mt.id(24), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from r), 'note', '합성'), (select revision from r), 'forbidden', '수납 확인은 운영 권한만으로 해결 불가');
create temp table f as select (mt.cmd(mt.id(25), 'submit', jsonb_build_object('participant_id', (select id from p2), 'learning_summary', '합성')) ->> 'id')::uuid as id;
select mt.cmd(mt.id(22), 'verify', jsonb_build_object('fulfillment_id', (select id from f), 'recognitions', jsonb_build_array(jsonb_build_object('case_id', (select other_month from k), 'minutes', 110))), mt.rev('makeup_fulfillments', (select id from f)));
select mt.eq((select lifecycle || ':' || closure_reason from public.makeup_cases where id = (select other_month from k)), 'closed:completed', '수납 확인 대사는 종결을 막지 않는다');
select mt.cmd(mt.id(22), 'resolve_reconciliation', jsonb_build_object('reconciliation_id', (select id from r), 'note', '수납 담당 확인'), (select revision from r));
select mt.eq((select state from public.makeup_reconciliation where id = (select id from r)), 'resolved', '수납 확인 해결 기록');
select count(*) as passed from mt.passed;
rollback;
