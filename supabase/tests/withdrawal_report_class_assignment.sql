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

create function pg_temp.target_payload(n int,authors jsonb,days int default 0) returns jsonb language sql as $$
 select pg_temp.payload(n,'["math","english"]','[]',days)||jsonb_build_object('teacherIds',authors,'enrollmentIds',(
  select jsonb_agg(e.id order by e.id) from public.enrollments e join public.classes c on c.id=e.class_id
  where e.student_id=('40000000-0000-4000-8000-00000000090'||n)::uuid and c.is_active and c.closed_at is null))
$$;
insert into gids values('merged',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(1,'["20000000-0000-4000-8000-000000000902"]')));
select is((select count(*)::int from public.withdrawal_reports where group_id=(select id from gids where k='merged')),1,'one selected author receives one merged report');
select is((select cardinality(enrollment_ids) from public.withdrawal_reports where group_id=(select id from gids where k='merged')),2,'merged report covers both teachers selected classes');
select is((select count(*)::int from public.notifications where tenant_id='10000000-0000-4000-8000-000000000901' and recipient_id='20000000-0000-4000-8000-000000000904'),0,'omitted homeroom teacher receives no report request');
select pg_temp.act('merged',2,2,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('merged',2,1,'approve');
select is(pg_temp.act('merged',2,7,'approve'),'completed','merged report approval processes every selected class');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000901' and end_date is not null and withdrawal_reason='schedule'),2,'both classes inherit the merged report reason and end date');
select is((select status::text from public.students where id='40000000-0000-4000-8000-000000000901'),'withdrawn','merged full selection withdraws student');

insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values ('30000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000901','Extra math','math','20000000-0000-4000-8000-000000000907');
insert into public.enrollments(tenant_id,student_id,class_id,start_date) values ('10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000902','30000000-0000-4000-8000-000000000903','2020-01-01');
insert into gids values('multiple',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(2,'["20000000-0000-4000-8000-000000000902","20000000-0000-4000-8000-000000000904"]')));
select is((select count(*)::int from public.withdrawal_reports where group_id=(select id from gids where k='multiple')),2,'multiple authors receive their own reports without omitted author');
select is((select sum(cardinality(enrollment_ids))::int from public.withdrawal_reports where group_id=(select id from gids where k='multiple')),2,'multiple authors see only their own selected classes');
select pg_temp.act('multiple',2,2,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('multiple',2,1,'approve');
select is(pg_temp.act('multiple',2,7,'approve'),'approved','all chosen authors reports must complete before termination');
select pg_temp.act('multiple',4,4,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('multiple',4,1,'approve');
select is(pg_temp.act('multiple',4,7,'approve'),'completed','last selected author report terminates the complete group');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000902' and end_date is not null and withdrawal_reason='schedule'),3,'all selected classes end including the omitted author class with a report reason');

insert into public.classes(id,tenant_id,class_name,subject,teacher_id,is_active,closed_at) values
 ('30000000-0000-4000-8000-000000000904','10000000-0000-4000-8000-000000000901','Ended','math','20000000-0000-4000-8000-000000000902',true,'2020-01-01'),
 ('30000000-0000-4000-8000-000000000905','10000000-0000-4000-8000-000000000901','Inactive','math','20000000-0000-4000-8000-000000000902',false,null);
insert into public.enrollments(tenant_id,student_id,class_id,start_date) select '10000000-0000-4000-8000-000000000901','40000000-0000-4000-8000-000000000903',id,'2020-01-01' from public.classes where id in ('30000000-0000-4000-8000-000000000904','30000000-0000-4000-8000-000000000905');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(3,'["20000000-0000-4000-8000-000000000902"]')||jsonb_build_object('enrollmentIds',(select jsonb_agg(id) from public.enrollments where student_id='40000000-0000-4000-8000-000000000903' and class_id='30000000-0000-4000-8000-000000000904')))$q$,'P0001',null,'ended class cannot be submitted by stale form');
select throws_ok($q$select public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(3,'["20000000-0000-4000-8000-000000000902"]')||jsonb_build_object('enrollmentIds',(select jsonb_agg(id) from public.enrollments where student_id='40000000-0000-4000-8000-000000000903' and class_id='30000000-0000-4000-8000-000000000905')))$q$,'P0001',null,'inactive class cannot be submitted by stale form');
insert into gids values('operating',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(3,'["20000000-0000-4000-8000-000000000902"]')));
select is((select exit_kind from public.withdrawal_report_groups where id=(select id from gids where k='operating')),'withdrawal','ended and inactive classes do not falsely keep student enrolled');
select is((select cardinality(enrollment_ids) from public.withdrawal_report_groups where id=(select id from gids where k='operating')),2,'only operating targets are saved');

insert into gids values('closed-later',public.request_withdrawal_report_group('10000000-0000-4000-8000-000000000901','20000000-0000-4000-8000-000000000901',pg_temp.target_payload(4,'["20000000-0000-4000-8000-000000000902"]')));
select pg_temp.act('closed-later',2,2,'submit',jsonb_build_object('body',pg_temp.body())); select pg_temp.act('closed-later',2,1,'approve');
update public.classes set is_active=false where id='30000000-0000-4000-8000-000000000901';
select throws_ok($q$select pg_temp.act('closed-later',2,7,'approve')$q$,'P0001',null,'class stopped after request requires review before final processing');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000904' and end_date is null),2,'failed final approval changes no enrollments');
select * from finish();
rollback;
