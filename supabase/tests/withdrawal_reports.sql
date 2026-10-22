-- Synthetic tenants only. Student changes, notifications, events, triggers all roll back.
begin;
create extension if not exists pgtap;
select set_config('request.jwt.claims','{}',true);
select no_plan();
select has_table('public','withdrawal_reports','reports exist');
select ok(not has_table_privilege('anon','public.withdrawal_reports','select'),'anonymous cannot read');
select ok(not has_table_privilege('authenticated','public.withdrawal_reports','update'),'client cannot bypass transitions');
select ok(not has_function_privilege('authenticated','public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)','execute'),'client cannot forge RPC actor');
select ok(not (select prosecdef from pg_proc where oid='public.transition_withdrawal_report(uuid,uuid,uuid,text,jsonb)'::regprocedure),'RPC does not bypass RLS');
insert into public.tenants(id,slug,name) values
 ('10000000-0000-4000-8000-000000000901','withdrawal-report-test-a','Report test A'),
 ('10000000-0000-4000-8000-000000000902','withdrawal-report-test-b','Report test B');
insert into public.users(id,tenant_id,email,display_name,system_role,status) values
 ('20000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','report-manager@test.invalid','Manager','admin','active'),
 ('20000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','report-teacher@test.invalid','Teacher','teacher','active'),
 ('20000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000901','report-director@test.invalid','Director','master','active'),
 ('20000000-0000-4000-8000-000000000904','10000000-0000-4000-8000-000000000901','report-other@test.invalid','Other','teacher','active'),
 ('20000000-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000902','report-foreign@test.invalid','Foreign','master','active'),
 ('20000000-0000-4000-8000-000000000906','10000000-0000-4000-8000-000000000901','report-replacement@test.invalid','Replacement','master','active');
insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values
 ('30000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','Report Math','math','20000000-0000-4000-8000-000000000902'),
 ('30000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','Report English','english','20000000-0000-4000-8000-000000000902');
insert into public.students(id,tenant_id,name,status,enrolled_at) values
 ('40000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','Report Student','enrolled','2020-01-01'),
 ('40000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','Scheduled Student','enrolled','2020-01-01'),
 ('40000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000901','Future Class Student','enrolled','2020-01-01'),
 ('40000000-0000-4000-8000-000000000904','10000000-0000-4000-8000-000000000901','Recovery Student','enrolled','2020-01-01');
insert into public.enrollments(id,tenant_id,student_id,class_id,start_date) values
 ('50000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000901','30000000-0000-4000-8000-000000000901','2020-01-01'),
 ('50000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000901','30000000-0000-4000-8000-000000000902','2020-01-01'),
 ('50000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000902','30000000-0000-4000-8000-000000000901','2020-01-01'),
 ('50000000-0000-4000-8000-000000000904','10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000903','30000000-0000-4000-8000-000000000901',(now() at time zone 'Asia/Seoul')::date+20),
 ('50000000-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000904','30000000-0000-4000-8000-000000000901','2020-01-01');
create temporary table test_report_ids(k text primary key,id uuid);
create function pg_temp.request_payload(student text, kind text default 'subject_end', subjects jsonb default '["math"]',future_days integer default 0) returns jsonb language sql as $$
 select jsonb_build_object('studentId',student,'teacherId','20000000-0000-4000-8000-000000000902','managerId','20000000-0000-4000-8000-000000000901',
 'directorId','20000000-0000-4000-8000-000000000903','exitKind',kind,'subjects',subjects,'effectiveDate',((now() at time zone 'Asia/Seoul')::date+future_days)::text,'note','Test request')
$$;
create function pg_temp.body() returns jsonb language sql as $$
 select jsonb_build_object('reason','schedule','detail',repeat('테스트 사유 ',50),'studentConsultation','학생과 상담함','parentConsultation','학부모와 상담함','teacherOpinion','종료 의견','attendance','양호','tuition','확인','arrears','no','arrearsNote','')
$$;
create function pg_temp.act(k text,who text, action text, payload jsonb default '{}') returns text language plpgsql as $$
declare r public.withdrawal_reports; begin
 select * into r from public.withdrawal_reports where id=(select id from test_report_ids where test_report_ids.k=act.k);
 r:=public.transition_withdrawal_report(r.tenant_id,who::uuid,r.id,action,payload||jsonb_build_object('revision',r.revision));
 return r.status;
end $$;
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000902',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901'))$q$,'P0001',null,'teacher cannot request');
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000905',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901'))$q$,'P0001',null,'foreign actor blocked');
insert into test_report_ids values('partial',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901'))).id);
select is((select status from public.withdrawal_reports where id=(select id from test_report_ids where k='partial')),'requested','request created');
select is((select count(*)::int from public.notifications where tenant_id='10000000-0000-4000-8000-000000000901'),1,'teacher notification persisted');
select is((select count(*)::int from public.enrollments where tenant_id='10000000-0000-4000-8000-000000000901' and end_date is not null),0,'request closes nothing');
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000902','20000000-0000-4000-8000-000000000905',(select id from test_report_ids where k='partial'),'cancel','{"revision":1}')$q$,'P0001',null,'foreign tenant cannot transition report');
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901','withdrawal'))$q$,'P0001',null,'full exit cannot omit another subject');
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901'))$q$,'23505',null,'duplicate pending request blocked');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000904','save',jsonb_build_object('body',pg_temp.body()))$q$,'P0001',null,'other teacher cannot write');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body()||'{"detail":"too short"}'))$q$,'P0001',null,'short submitted report rejected');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000902','save',jsonb_build_object('body',pg_temp.body()||'{"detail":"draft"}')),'requested','short draft allowed');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','teacher submits to manager');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000903','approve')$q$,'P0001',null,'director cannot skip manager');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000902','approve')$q$,'P0001',null,'author cannot self-approve');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000901','reject','{"comment":""}')$q$,'P0001',null,'rejection needs explanation');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000901','reject','{"comment":"추가 작성"}'),'revision','manager rejects');
select is((select count(*)::int from public.enrollments where tenant_id='10000000-0000-4000-8000-000000000901' and end_date is not null),0,'rejection closes nothing');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','resubmission restarts review');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000901','approve'),'director_pending','manager approval waits for director');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000901'),null::date,'manager approval does not close');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000902','save',jsonb_build_object('body',pg_temp.body()))$q$,'P0001',null,'submitted body locked');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000903','reject','{"comment":"원장 수정 요청"}'),'revision','director can request revision');
select ok((select manager_approved_at is null and director_approved_at is null from public.withdrawal_reports where id=(select id from test_report_ids where k='partial')),'revision invalidates both approvals');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','teacher resubmits');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000901','approve'),'director_pending','manager reapproves');
select throws_ok($q$select public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000903',(select id from test_report_ids where k='partial'),'approve','{"revision":1}')$q$,'P0001',null,'stale tab cannot approve');
select is(pg_temp.act('partial','20000000-0000-4000-8000-000000000903','approve'),'completed','two approvals apply partial exit');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000901'),(now() at time zone 'Asia/Seoul')::date,'selected subject closed');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000902'),null::date,'other subject preserved');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'enrolled','partial exit preserves enrolled status');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000903','approve')$q$,'P0001',null,'repeat approval cannot double apply');
select throws_ok($q$select pg_temp.act('partial','20000000-0000-4000-8000-000000000901','cancel')$q$,'P0001',null,'completed report cannot cancel');
insert into test_report_ids values('scheduled',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000902','withdrawal','["math"]',10))).id);
select is(pg_temp.act('scheduled','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','future report submits');
select is(pg_temp.act('scheduled','20000000-0000-4000-8000-000000000901','approve'),'director_pending','future manager approves');
select is(pg_temp.act('scheduled','20000000-0000-4000-8000-000000000903','approve'),'scheduled','future director queues report');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000902'),'enrolled','future approval preserves status');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000903'),null::date,'future approval preserves course');
select throws_ok($q$select pg_temp.act('scheduled',null,'apply')$q$,'P0001',null,'cannot apply before date');
-- Advance the fixture's clock by changing only its approved date; no real records involved.
update public.withdrawal_reports set effective_date=(now() at time zone 'Asia/Seoul')::date where id=(select id from test_report_ids where k='scheduled');
update public.enrollments set on_hold=true where id='50000000-0000-4000-8000-000000000903';
select is(pg_temp.act('scheduled',null,'apply'),'blocked','changed course blocks automatic processing');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000902'),'enrolled','blocked report leaves student enrolled');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000903'),null::date,'blocked report leaves course unchanged');
select is(pg_temp.act('scheduled','20000000-0000-4000-8000-000000000901','cancel'),'canceled','blocked report can be canceled and re-requested');
insert into test_report_ids values('full',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000902','withdrawal'))).id);
select is(pg_temp.act('full','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body()||'{"reason":"illness"}')),'manager_pending','shared illness reason accepted');
select is(pg_temp.act('full','20000000-0000-4000-8000-000000000901','approve'),'director_pending','full report first approval');
select is(pg_temp.act('full','20000000-0000-4000-8000-000000000903','approve'),'completed','full exit applied');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000902'),'withdrawn','full exit changes status');
select is((select withdrawn_at from public.students where id='40000000-0000-4000-8000-000000000902'),(now() at time zone 'Asia/Seoul')::date,'full exit records date');
select is((select withdrawal_metadata->>'reason' from public.students where id='40000000-0000-4000-8000-000000000902'),'illness','full exit records report reason');
insert into test_report_ids values('clamp',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000903','withdrawal'))).id);
select is(pg_temp.act('clamp','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body()||'{"reason":"advised"}')),'manager_pending','shared advised exit reason accepted');
select is(pg_temp.act('clamp','20000000-0000-4000-8000-000000000901','approve'),'director_pending','future class first approval');
select is(pg_temp.act('clamp','20000000-0000-4000-8000-000000000903','approve'),'completed','future class exit applied');
select ok((select end_date=start_date from public.enrollments where id='50000000-0000-4000-8000-000000000904'),'future enrollment clamped without negative range');
select ok((select count(*) from public.withdrawal_report_events where tenant_id='10000000-0000-4000-8000-000000000901' and action='approve')>=7,'approval events kept');
insert into test_report_ids values('scheduled-success',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000901','withdrawal','["math","english"]',10))).id);
select is(pg_temp.act('scheduled-success','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','second future report submits');
select is(pg_temp.act('scheduled-success','20000000-0000-4000-8000-000000000901','approve'),'director_pending','second future manager approves');
select is(pg_temp.act('scheduled-success','20000000-0000-4000-8000-000000000903','approve'),'scheduled','second future director approves');
update public.withdrawal_reports set effective_date=(now() at time zone 'Asia/Seoul')::date where id=(select id from test_report_ids where k='scheduled-success');
select is(pg_temp.act('scheduled-success',null,'apply'),'completed','due unchanged report applies automatically');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'withdrawn','due approved report changes student status');
select ok((select manager_approved_at is not null and director_approved_at is not null and applied_at is not null from public.withdrawal_reports where id=(select id from test_report_ids where k='scheduled-success')),'applied report keeps both approval timestamps');
insert into test_report_ids values('recovery',(public.transition_withdrawal_report('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',null,'request',pg_temp.request_payload('40000000-0000-4000-8000-000000000904','withdrawal'))).id);
select is(pg_temp.act('recovery','20000000-0000-4000-8000-000000000902','submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','recovery report submitted');
update public.users set status='inactive' where id in ('20000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000903');
select throws_ok($q$select pg_temp.act('recovery','20000000-0000-4000-8000-000000000906','approve')$q$,'P0001',null,'replacement principal cannot approve assigned reviewer turn');
select throws_ok($q$select pg_temp.act('recovery','20000000-0000-4000-8000-000000000906','cancel')$q$,'P0001',null,'replacement principal cannot cancel another sender request');
update public.users set status='active' where id='20000000-0000-4000-8000-000000000901';
select is(pg_temp.act('recovery','20000000-0000-4000-8000-000000000901','cancel'),'canceled','original requester can cancel');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000904'),'enrolled','recovery cancellation preserves student');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000905'),null::date,'recovery cancellation preserves enrollment');
select * from finish();
rollback;
