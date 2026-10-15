create extension if not exists pgtap;
select no_plan();
select set_config('request.jwt.claims','{}',true);
insert into public.tenants(id,slug,name) values('10000000-0000-4000-8000-000000000951','student-status-synthetic','Status Test');
insert into public.users(id,tenant_id,email,display_name,system_role,status) values
 ('20000000-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000951','status-basic@test.invalid','Basic','admin','active'),
 ('20000000-0000-4000-8000-000000000952','10000000-0000-4000-8000-000000000951','status-owner@test.invalid','Owner','master','active'),
 ('20000000-0000-4000-8000-000000000953','10000000-0000-4000-8000-000000000951','status-teacher@test.invalid','Teacher','teacher','active');
insert into public.tenant_settings(tenant_id,data) values('10000000-0000-4000-8000-000000000951','{"version":1,"preset":"generic","permissions":{"overrides":[],"userOverrides":[],"specialAccess":{}}}');
insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values
 ('30000000-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000951','Status A','math','20000000-0000-4000-8000-000000000953'),
 ('30000000-0000-4000-8000-000000000952','10000000-0000-4000-8000-000000000951','Status B','math','20000000-0000-4000-8000-000000000953');
insert into public.students(id,tenant_id,name,status) values
 ('40000000-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000951','Status Fixture','enrolled');
insert into public.enrollments(id,tenant_id,student_id,class_id,start_date) values
 ('50000000-0000-4000-8000-000000000951','10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000951','30000000-0000-4000-8000-000000000951','2020-01-01');
select ok(not pg_has_role('authenticated','student_status_lifecycle','member'),'clients cannot assume lifecycle executor');
select ok((select not rolcanlogin and not rolbypassrls from pg_roles where rolname='student_status_lifecycle'),'executor cannot login or bypass RLS');
select ok(pg_has_role('student_status_lifecycle','authenticated','member'),'executor inherits existing RLS role');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename in ('students','enrollments') and policyname like '%_role_gate'),6,'all office role policies remain');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select is(student_status_private.menu('students'),'full','SQL default mirrors students full');
select ok(student_status_private.allowed(),'raw absence retains legacy operator');
select lives_ok($q$update public.students set status='on_hold' where id='40000000-0000-4000-8000-000000000951'$q$,'legacy status change retained');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.students set status='enrolled' where id='40000000-0000-4000-8000-000000000951';
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess}','{"studentStatusManagerIds":[]}') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select ok(not student_status_private.allowed(),'explicit empty revokes legacy operator');
select lives_ok($q$update public.students set school='Synthetic school' where id='40000000-0000-4000-8000-000000000951'$q$,'basic profile edits retained');
select throws_ok($q$update public.students set status='withdrawn' where id='40000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct withdrawal denied');
select throws_ok($q$update public.students set withdrawn_at=current_date+7 where id='40000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct schedule denied');
select throws_ok($q$update public.enrollments set on_hold=true where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct hold denied');
select throws_ok($q$update public.enrollments set end_date=current_date where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct end denied');
select throws_ok($q$update public.enrollments set start_date=current_date+1 where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct start rescheduling denied');
select throws_ok($q$update public.enrollments set end_date=current_date,is_transferred=true,withdrawal_reason='반 이동' where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'forged transfer marker denied');
select throws_ok($q$delete from public.enrollments where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'direct active deletion denied');
select ok(not has_schema_privilege('authenticated','public','create'),'client cannot install a context setter or forged RPC');
select throws_ok($q$insert into public.students(tenant_id,name,status) values('10000000-0000-4000-8000-000000000951','Forged initial hold','on_hold')$q$,'P0001',null,'initial hold denied');
select throws_ok($q$insert into public.enrollments(tenant_id,student_id,class_id,start_date,end_date) values('10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000951','30000000-0000-4000-8000-000000000952',current_date,current_date+1)$q$,'P0001',null,'initial ended enrollment denied');
select is((public.move_enrollments_batch('[{"enrollmentId":"50000000-0000-4000-8000-000000000951","newClassId":"30000000-0000-4000-8000-000000000952"}]',(now() at time zone 'Asia/Seoul')::date+7)->0->>'ok'),'true','validated move works without status assignment');
select is((select count(*)::int from public.enrollments where student_id='40000000-0000-4000-8000-000000000951'),2,'move writes paired enrollment once');
select is((public.change_scheduled_enrollment((select id from public.enrollments where is_transferred_in and student_id='40000000-0000-4000-8000-000000000951'),'50000000-0000-4000-8000-000000000951','cancel')->>'ok'),'true','validated paired cancel retained');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000951'),null::date,'paired cancel restores source');
select throws_ok($q$select public.delete_enrollment_history('50000000-0000-4000-8000-000000000951','{}')$q$,'P0001',null,'basic operator cannot delete started history');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess,enrollmentDateEditorIds}','["20000000-0000-4000-8000-000000000951"]') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select lives_ok($q$update public.enrollments set end_date=current_date where id='50000000-0000-4000-8000-000000000951'$q$,'independent date editor can set end');
select lives_ok($q$update public.enrollments set end_date=null,withdrawal_reason=null,is_transferred=false where id='50000000-0000-4000-8000-000000000951'$q$,'independent date editor can clear end');
select throws_ok($q$update public.enrollments set on_hold=true where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'date assignment cannot hold');
select throws_ok($q$update public.enrollments set withdrawal_reason='arbitrary' where id='50000000-0000-4000-8000-000000000951'$q$,'P0001',null,'date assignment cannot invent reason');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess,studentStatusManagerIds}','["20000000-0000-4000-8000-000000000951"]') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select ok(student_status_private.allowed(),'named office operator permitted');
select lives_ok($q$update public.students set status='on_hold' where id='40000000-0000-4000-8000-000000000951'$q$,'named operator can hold');
select lives_ok($q$update public.enrollments set on_hold=true where id='50000000-0000-4000-8000-000000000951'$q$,'named operator enrollment hold permitted');
select is((public.move_enrollments_batch('[{"enrollmentId":"50000000-0000-4000-8000-000000000951","newClassId":"30000000-0000-4000-8000-000000000952"}]',(now() at time zone 'Asia/Seoul')::date+8)->0->>'ok'),'true','held transfer retained');
select ok((select on_hold from public.enrollments where is_transferred_in and student_id='40000000-0000-4000-8000-000000000951'),'transfer inherits held state');
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000953","role":"authenticated"}',true);
select ok(not student_status_private.allowed(),'teacher denied despite unrelated office grants');
select throws_ok($q$select public.move_enrollments_batch('[{"enrollmentId":"50000000-0000-4000-8000-000000000951","newClassId":"30000000-0000-4000-8000-000000000952"}]',current_date+9)$q$,'P0001',null,'teacher cannot use executor');
reset role;
select set_config('request.jwt.claims','{}',true);
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000952","role":"authenticated"}',true);
set local role authenticated;
select ok(student_status_private.allowed(),'owner keeps authority');
select throws_ok($q$update public.tenant_settings set data=data #- '{permissions,specialAccess,studentStatusManagerIds}' where tenant_id='10000000-0000-4000-8000-000000000951'$q$,'P0001',null,'old form cannot erase explicit revocation');
reset role;
select set_config('request.jwt.claims','{}',true);
-- Extra adversarial cases run on synthetic rows only.
insert into public.tenants(id,slug,name) values('10000000-0000-4000-8000-000000000952','status-foreign-test','Foreign');
insert into public.classes(id,tenant_id,class_name,subject) values('30000000-0000-4000-8000-000000000953','10000000-0000-4000-8000-000000000952','Foreign','math');
insert into public.students(id,tenant_id,name,status) values('40000000-0000-4000-8000-000000000952','10000000-0000-4000-8000-000000000951','Extra Fixture','enrolled');
insert into public.enrollments(id,tenant_id,student_id,class_id,start_date) values
 ('50000000-0000-4000-8000-000000000952','10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000952','30000000-0000-4000-8000-000000000951','2020-01-01'),
 ('50000000-0000-4000-8000-000000000953','10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000952','30000000-0000-4000-8000-000000000952',(now() at time zone 'Asia/Seoul')::date+20);
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess,studentStatusManagerIds}','[]') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select set_config('student_status.ctx','trusted',true);
select throws_ok($q$update public.students set status='withdrawn' where id='40000000-0000-4000-8000-000000000952'$q$,'P0001',null,'forged custom context has no authority');
select is((public.move_enrollments_batch('[{"enrollmentId":"50000000-0000-4000-8000-000000000952","newClassId":"30000000-0000-4000-8000-000000000953"}]',current_date+5)->0->>'ok'),'false','cross tenant transfer rejected inside per-row transaction');
select is((select end_date from public.enrollments where id='50000000-0000-4000-8000-000000000952'),null::date,'failed transfer leaves source unchanged');
select is((select count(*)::int from public.delete_enrollment_history('50000000-0000-4000-8000-000000000953','{}')),1,'unstarted assignment cancellation remains independent');
reset role;
select set_config('request.jwt.claims','{}',true);
select is((select count(*)::int from public.audit_logs where tenant_id='10000000-0000-4000-8000-000000000951' and action='enrollment_delete' and metadata->>'via'='validated_rpc'),1,'direct validated delete leaves snapshot audit');
select ok((select target_label='Status B' and metadata ?& array['studentId','classId','className','subject','recordCounts','cancelledBeforeStart','hadSiblingEnrollment','thisRowHasTier','siblingHasTier']
  and metadata->'snapshot' ?& array['id','tenantId','studentId','classId','startDate','endDate','onHold','withdrawalReason','attendanceDays','isTransferred','isTransferredIn','salaryTier','createdAt']
  and metadata->'recordCounts' ?& array['attendance','lessonReports','onescreenSessions','sheetMarks','followups','billing']
  and metadata->>'cancelledBeforeStart'='true'
  from public.audit_logs where tenant_id='10000000-0000-4000-8000-000000000951' and action='enrollment_delete' and metadata->>'via'='validated_rpc'),'single audit preserves full camelCase snapshot and record-count contract');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess,studentStatusManagerIds}','null') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select ok(not student_status_private.allowed(),'explicit null fails closed in SQL');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,specialAccess,studentStatusManagerIds}','["20000000-0000-4000-8000-000000000951"]') where tenant_id='10000000-0000-4000-8000-000000000951';
update public.tenant_settings set data=jsonb_set(data,'{permissions,userOverrides}','[{"userId":"20000000-0000-4000-8000-000000000951","menu":"students","access":"readonly"}]') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select ok(not student_status_private.allowed(),'named assignment cannot widen readonly students menu');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.attendance_records(tenant_id,student_id,class_id,session_date,status)
 values('10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000952','30000000-0000-4000-8000-000000000951',current_date,'present');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000952","role":"authenticated"}',true);
select throws_ok($q$select public.delete_enrollment_history('50000000-0000-4000-8000-000000000952','{}')$q$,'P0001',null,'owner history deletion keeps linked-record guard');
select lives_ok($q$update public.students set status='withdrawn',withdrawn_at=current_date where id='40000000-0000-4000-8000-000000000952'$q$,'owner direct status retained');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select lives_ok($q$update public.students set status='enrolled',withdrawn_at=null where id='40000000-0000-4000-8000-000000000952'$q$,'trusted scheduled/system application does not require individual assignment');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(jsonb_set(data,'{permissions,specialAccess}',
  '{"studentStatusManagerIds":["20000000-0000-4000-8000-000000000953"],"enrollmentDateEditorIds":["20000000-0000-4000-8000-000000000953"]}'),
  '{permissions,userOverrides}','[{"userId":"20000000-0000-4000-8000-000000000953","menu":"students","access":"full"}]') where tenant_id='10000000-0000-4000-8000-000000000951';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000953","role":"authenticated"}',true);
select ok(not student_status_private.allowed(),'named teacher with full students override still fails office boundary');
with changed as(update public.students set status='on_hold' where id='40000000-0000-4000-8000-000000000952' returning id)
select is((select count(*)::int from changed),0,'actual office RLS still denies teacher writes');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,userOverrides}','[]') where tenant_id='10000000-0000-4000-8000-000000000951';
insert into public.classes(id,tenant_id,class_name,subject) values('30000000-0000-4000-8000-000000000954','10000000-0000-4000-8000-000000000951','Out of scope','math');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000953","role":"authenticated"}',true);
select ok(student_status_private.date_allowed('30000000-0000-4000-8000-000000000951'),'scoped date editor retains own class');
select ok(not student_status_private.date_allowed('30000000-0000-4000-8000-000000000954'),'scoped date editor cannot widen to other local class');
select ok(not student_status_private.date_allowed('30000000-0000-4000-8000-000000000953'),'scoped date editor cannot widen to other tenant');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.class_schedules(tenant_id,class_id,day_of_week,start_time,end_time,valid_from,valid_to,created_at)
 values('10000000-0000-4000-8000-000000000951','30000000-0000-4000-8000-000000000954','mon','09:00','10:00','2020-01-01',current_date-1,'2020-01-01');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000951","role":"authenticated"}',true);
select throws_ok($q$insert into public.enrollments(tenant_id,student_id,class_id,start_date,end_date,withdrawal_reason) values('10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000952','30000000-0000-4000-8000-000000000952',current_date,current_date,'운영 기간 종료')$q$,'P0001',null,'NULL operating period plus forged reason cannot authorize initial end');
select lives_ok($q$insert into public.enrollments(tenant_id,student_id,class_id,start_date) values('10000000-0000-4000-8000-000000000951','40000000-0000-4000-8000-000000000952','30000000-0000-4000-8000-000000000954','2020-01-01')$q$,'actual ended operating period still derives enrollment end without status assignment');
select is((select end_date from public.enrollments where student_id='40000000-0000-4000-8000-000000000952' and class_id='30000000-0000-4000-8000-000000000954'),current_date-1,'derived end matches actual operating period');
reset role;
select set_config('request.jwt.claims','{}',true);
select * from finish();
