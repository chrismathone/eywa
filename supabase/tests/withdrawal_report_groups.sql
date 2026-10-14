begin;
create extension if not exists pgtap;
select set_config('request.jwt.claims','{}',true);
select no_plan();
insert into public.tenants(id,slug,name) values ('10000000-0000-4000-8000-000000000901','report-group-test','Report Group Test'),('10000000-0000-4000-8000-000000000902','report-group-foreign','Foreign');
insert into public.users(id,tenant_id,email,display_name,system_role,status) values
 ('20000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','g-manager@test.invalid','Manager','admin','active'),
 ('20000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','g-teacher@test.invalid','Math teacher','teacher','active'),
 ('20000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000901','g-director@test.invalid','Director','master','active'),
 ('20000000-0000-4000-8000-000000000904','10000000-0000-4000-8000-000000000901','g-teacher2@test.invalid','English teacher','teacher','active'),
 ('20000000-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000902','g-foreign@test.invalid','Foreign','master','active'),
 ('20000000-0000-4000-8000-000000000906','10000000-0000-4000-8000-000000000901','g-director2@test.invalid','Director2','master','active'),
 ('20000000-0000-4000-8000-000000000907','10000000-0000-4000-8000-000000000901','g-manager2@test.invalid','Manager2','admin','active');
insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values
 ('30000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','Math','math','20000000-0000-4000-8000-000000000902'),
 ('30000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000901','English','english','20000000-0000-4000-8000-000000000904');
insert into public.students(id,tenant_id,name,status,enrolled_at) select ('40000000-0000-4000-8000-00000000090'||n)::uuid,'10000000-0000-4000-8000-000000000901','Group Student '||n,'enrolled','2020-01-01' from generate_series(1,4) n;
insert into public.enrollments(tenant_id,student_id,class_id,start_date) select '10000000-0000-4000-8000-000000000901',s.id,c.id,'2020-01-01' from public.students s cross join public.classes c where s.tenant_id='10000000-0000-4000-8000-000000000901' and c.tenant_id=s.tenant_id;
create temporary table gids(k text,id uuid);
create function pg_temp.payload(n int,subjects jsonb default '["math","english"]',directors jsonb default '[]',days int default 0) returns jsonb language sql as $$
 select jsonb_build_object('studentId','40000000-0000-4000-8000-00000000090'||n,'teacherIds',case when subjects='["math"]'::jsonb then '["20000000-0000-4000-8000-000000000902"]'::jsonb else '["20000000-0000-4000-8000-000000000902","20000000-0000-4000-8000-000000000904"]'::jsonb end,'managerIds','["20000000-0000-4000-8000-000000000901","20000000-0000-4000-8000-000000000907"]'::jsonb,'directorIds',directors,'subjects',subjects,'effectiveDate',((now() at time zone 'Asia/Seoul')::date+days)::text,'note','Fixture')
$$;
create function pg_temp.body() returns jsonb language sql as $$ select jsonb_build_object('reason','schedule','detail',repeat('테스트 사유 ',50),'studentConsultation','상담','parentConsultation','상담','teacherOpinion','의견','attendance','','tuition','','arrears','no','arrearsNote','') $$;
create function pg_temp.act(k text,t int,a int,op text,payload jsonb default '{}') returns text language plpgsql as $$ declare r public.withdrawal_reports; begin
 select q.* into r from public.withdrawal_reports q where q.group_id=(select id from gids where gids.k=act.k) and q.teacher_id=('20000000-0000-4000-8000-00000000090'||t)::uuid;
 r:=public.transition_withdrawal_report(r.tenant_id,case when a is null then null else ('20000000-0000-4000-8000-00000000090'||a)::uuid end,r.id,op,payload||jsonb_build_object('revision',r.revision)); return r.status;
end $$;
select ok(not has_function_privilege('authenticated','public.request_withdrawal_report_group(uuid,uuid,jsonb)','execute'),'client cannot forge batch actor');
select ok(not has_table_privilege('authenticated','public.withdrawal_report_groups','select'),'client cannot read batches');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000902',pg_temp.payload(1))$q$,'P0001',null,'author cannot request');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000905',pg_temp.payload(1))$q$,'P0001',null,'foreign requester denied');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(1)||'{"teacherIds":["20000000-0000-4000-8000-000000000902"]}')$q$,'P0001',null,'cannot omit targeted teacher');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(1)||'{"managerIds":["20000000-0000-4000-8000-000000000902"]}')$q$,'P0001',null,'author cannot review own report');
insert into gids values('full',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(1)));
select is((select count(*)::int from public.withdrawal_reports where group_id=(select id from gids where k='full')),2,'one independent report per teacher');
select is((select count(*)::int from public.notifications where tenant_id='10000000-0000-4000-8000-000000000901'),2,'every teacher notified');
select is((select exit_kind from public.withdrawal_report_groups where id=(select id from gids where k='full')),'withdrawal','all subjects imply whole withdrawal');
select is((select count(*)::int from public.enrollments where tenant_id='10000000-0000-4000-8000-000000000901' and end_date is not null),0,'request does not close courses');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(1))$q$,'23505',null,'duplicate group denied');
select throws_ok($q$select pg_temp.act('full',2,4,'save',jsonb_build_object('body',pg_temp.body()))$q$,'P0001',null,'each teacher writes only own report');
select is(pg_temp.act('full',2,2,'submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','no principal needed to submit');
select is((select count(*)::int from public.notifications where tenant_id='10000000-0000-4000-8000-000000000901' and title='퇴원보고서 관리자 승인 요청'),2,'every selected manager notified');
select is(pg_temp.act('full',2,1,'approve'),'manager_pending','first manager waits for second');
select throws_ok($q$select pg_temp.act('full',2,1,'approve')$q$,'P0001',null,'same manager cannot double approve');
select is(pg_temp.act('full',2,7,'approve'),'approved','managers are final when principal omitted');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'enrolled','one approved child cannot withdraw student');
select is(pg_temp.act('full',4,4,'submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','second teacher independently submits');
select is(pg_temp.act('full',4,1,'reject','{"comment":"보완"}'),'revision','rejection returns only this author');
select is((select status from public.withdrawal_reports where group_id=(select id from gids where k='full') and teacher_id='20000000-0000-4000-8000-000000000902'),'approved','other report approval retained');
select is(pg_temp.act('full',4,4,'submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','resubmit restarts own approvals');
select is(pg_temp.act('full',4,7,'approve'),'manager_pending','review order within stage flexible');
select is(pg_temp.act('full',4,1,'approve'),'completed','last approval atomically applies all reports');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'withdrawn','full withdrawal applied');
select is((select count(*)::int from public.withdrawal_reports where group_id=(select id from gids where k='full') and status='completed'),2,'all siblings completed');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000901' and end_date=(now() at time zone 'Asia/Seoul')::date),2,'both subjects closed once');
select throws_ok($q$select pg_temp.act('full',4,1,'approve')$q$,'P0001',null,'applied group cannot reapply');
insert into gids values('partial',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(2,'["math"]','["20000000-0000-4000-8000-000000000903","20000000-0000-4000-8000-000000000906"]')));
select is((select exit_kind from public.withdrawal_report_groups where id=(select id from gids where k='partial')),'subject_end','subset implies subject termination');
select is(pg_temp.act('partial',2,2,'submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','principal path begins with managers');
select throws_ok($q$select pg_temp.act('partial',2,3,'approve')$q$,'P0001',null,'principal cannot skip manager stage');
select is(pg_temp.act('partial',2,1,'approve'),'manager_pending','first of two managers');
select is(pg_temp.act('partial',2,7,'approve'),'director_pending','all managers advance to principals');
select is((select count(*)::int from public.notifications where title='퇴원보고서 원장 승인 요청' and tenant_id='10000000-0000-4000-8000-000000000901'),2,'every chosen principal notified');
select is(pg_temp.act('partial',2,3,'approve'),'director_pending','first principal does not finalize');
select is(pg_temp.act('partial',2,6,'reject','{"comment":"보완"}'),'revision','remaining principal can reject');
select ok((select manager_decisions='{}'::jsonb and director_decisions='{}'::jsonb from public.withdrawal_reports where group_id=(select id from gids where k='partial')),'rejection clears all decisions on this report');
select is(pg_temp.act('partial',2,2,'submit',jsonb_build_object('body',pg_temp.body())),'manager_pending','principal rejection resubmits to managers');
select pg_temp.act('partial',2,1,'approve'); select pg_temp.act('partial',2,7,'approve'); select pg_temp.act('partial',2,3,'approve');
select is(pg_temp.act('partial',2,6,'approve'),'completed','both principals finalize');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000902'),'enrolled','partial preserves student status');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000902' and end_date is null),1,'unselected course preserved');
insert into gids values('future',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(3,'["math"]','[]',10)));
select pg_temp.act('future',2,2,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('future',2,1,'approve');
select is(pg_temp.act('future',2,7,'approve'),'scheduled','future no-principal approval schedules');
select throws_ok($q$select pg_temp.act('future',2,null,'apply')$q$,'P0001',null,'cannot process early');
update public.withdrawal_report_groups set effective_date=(now() at time zone 'Asia/Seoul')::date where id=(select id from gids where k='future');
select is(pg_temp.act('future',2,null,'apply'),'completed','unchanged due target applies automatically');
insert into gids values('changed',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(4,'["math"]','[]',10)));
select pg_temp.act('changed',2,2,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('changed',2,1,'approve'); select pg_temp.act('changed',2,7,'approve');
update public.withdrawal_report_groups set effective_date=(now() at time zone 'Asia/Seoul')::date where id=(select id from gids where k='changed');
update public.enrollments set on_hold=true where student_id='40000000-0000-4000-8000-000000000904';
select is(pg_temp.act('changed',2,null,'apply'),'blocked','changed target safely blocks');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000904' and end_date is null),2,'blocked group closes nothing');
select is(pg_temp.act('changed',2,6,'cancel'),'canceled','replacement principal can recover stuck group');
select ok(not has_table_privilege('authenticated','public.withdrawal_report_archives','select'),'archive client reads denied');
select ok(not has_function_privilege('authenticated','public.map_withdrawal_report_archive(uuid,uuid,uuid,uuid,integer)','execute'),'archive actor cannot be forged');
insert into public.withdrawal_report_archives(id,tenant_id,spreadsheet_id,source_key,sheet_id,sheet_title,source_range,student_name,school_grade,class_name,subject,raw_exit_date,teacher_name,fields,signatures,raw_grid) values('60000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000901','fixture','one',1,'Fixture','A1:N23','Student','','','math','','','{}','[]','[]');
select throws_ok($q$select public.map_withdrawal_report_archive('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000902','60000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000901',1)$q$,'P0001',null,'teacher cannot map historical identities');
select throws_ok($q$select public.map_withdrawal_report_archive('10000000-0000-4000-8000-000000000902','20000000-0000-4000-8000-000000000905','60000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000901',1)$q$,'P0001',null,'foreign tenant cannot map archive');
select lives_ok($q$select public.map_withdrawal_report_archive('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901','60000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000901',1)$q$,'admin maps a historical record');
select is((select mapping_kind from public.withdrawal_report_archives where id='60000000-0000-4000-8000-000000000901'),'manual','mapping marked manual');
select throws_ok($q$select public.map_withdrawal_report_archive('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901','60000000-0000-4000-8000-000000000901',null,1)$q$,'P0001',null,'stale mapping cannot overwrite current choice');
select is((select count(*)::int from public.withdrawal_report_archive_mappings where tenant_id='10000000-0000-4000-8000-000000000901'),1,'mapping audit retained');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'withdrawn','archive mapping does not change current state');
-- Reopen only the synthetic canceled student's changed target, then ensure an ownership change prevents submission.
insert into gids values('assignment',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(4,'["math"]')));
update public.classes set teacher_id='20000000-0000-4000-8000-000000000904' where id='30000000-0000-4000-8000-000000000901';
select throws_ok($q$select pg_temp.act('assignment',2,2,'submit',jsonb_build_object('body',pg_temp.body()))$q$,'P0001',null,'reassigned homeroom cannot submit obsolete ownership');
select is((select status from public.withdrawal_reports where group_id=(select id from gids where k='assignment')),'requested','failed submission preserves draft state');
select pg_temp.act('assignment',2,1,'cancel');
update public.classes set teacher_id='20000000-0000-4000-8000-000000000902' where id='30000000-0000-4000-8000-000000000901';
insert into gids values('review-assignment',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.payload(4,'["math"]')));
select pg_temp.act('review-assignment',2,2,'submit',jsonb_build_object('body',pg_temp.body()));
update public.classes set teacher_id='20000000-0000-4000-8000-000000000904' where id='30000000-0000-4000-8000-000000000901';
select throws_ok($q$select pg_temp.act('review-assignment',2,1,'approve')$q$,'P0001',null,'ownership changes block even the first reviewer');
select ok((select manager_decisions='{}'::jsonb from public.withdrawal_reports where group_id=(select id from gids where k='review-assignment')),'failed approval retains no misleading decision');
select * from finish();
rollback;
