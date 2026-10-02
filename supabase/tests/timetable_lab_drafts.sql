-- Run after the draft migration. All fixture writes roll back, including role/permission changes.
begin;
create extension if not exists pgtap;
select set_config('request.jwt.claims','{}',true);
select plan(33);
select has_table('public','timetable_lab_drafts','draft table exists');
select col_not_null('public','timetable_lab_drafts','tenant_id','tenant is required');
select ok((select relrowsecurity from pg_class where oid='public.timetable_lab_drafts'::regclass),'RLS enabled');
select ok(not has_table_privilege('anon','public.timetable_lab_drafts','select'),'anonymous cannot read');
select ok(has_table_privilege('authenticated','public.timetable_lab_drafts','select'),'authenticated has select grant');
select ok(not has_table_privilege('authenticated','public.timetable_lab_drafts','update'),'saved snapshots cannot be overwritten');
select ok(not (select prosecdef from pg_proc where oid='public.auth_can_use_timetable_lab()'::regprocedure),'permission helper is invoker');

insert into public.tenants(id,slug,name) values
 ('10000000-0000-4000-8000-000000000071','lab-draft-rls-a','Draft test A'),
 ('10000000-0000-4000-8000-000000000072','lab-draft-rls-b','Draft test B');
insert into public.users(id,tenant_id,email,display_name,system_role,status) values
 ('20000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','draft-a@rls.test','Owner','admin','active'),
 ('20000000-0000-4000-8000-000000000072','10000000-0000-4000-8000-000000000071','draft-peer@rls.test','Peer','admin','active'),
 ('20000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000072','draft-other@rls.test','Other','admin','active'),
 ('20000000-0000-4000-8000-000000000074','10000000-0000-4000-8000-000000000071','draft-teacher@rls.test','Teacher','teacher','active'),
 ('20000000-0000-4000-8000-000000000075','10000000-0000-4000-8000-000000000071','draft-inactive@rls.test','Inactive','admin','inactive'),
 ('20000000-0000-4000-8000-000000000076','10000000-0000-4000-8000-000000000071','draft-student@rls.test','Student','student','active');
insert into public.tenant_settings(tenant_id,data) values ('10000000-0000-4000-8000-000000000071','{}');

select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000071"}',true);
set local role authenticated;
select lives_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071','First','{"cells":[],"placements":[],"students":{}}',0,0,0)$q$,'admin can create own draft');
select is((select count(*)::int from public.timetable_lab_drafts),1,'owner sees own draft');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000072','20000000-0000-4000-8000-000000000071','Foreign','{"cells":[],"placements":[],"students":{}}',0,0,0)$q$,'42501',null,'cross-tenant insert blocked');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000072','Peer','{"cells":[],"placements":[],"students":{}}',0,0,0)$q$,'42501',null,'forged creator blocked');
select throws_ok($q$update public.timetable_lab_drafts set name='Overwritten'$q$,'42501',null,'update blocked');
select throws_ok($q$delete from public.timetable_lab_drafts$q$,'42501',null,'delete blocked');

reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000072"}',true);
set local role authenticated;
select is((select count(*)::int from public.timetable_lab_drafts),0,'same-tenant colleague cannot read owner draft');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000073"}',true);
set local role authenticated;
select is((select count(*)::int from public.timetable_lab_drafts),0,'other tenant cannot read owner draft');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000074"}',true);
set local role authenticated;
select ok(not public.auth_can_use_timetable_lab(),'scoped teacher lacks full management');
select is((select count(*)::int from public.timetable_lab_drafts),0,'scoped teacher reads no drafts');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000074','Teacher','{"cells":[],"placements":[],"students":{}}',0,0,0)$q$,'42501',null,'scoped teacher cannot save');

reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data='{"permissions":{"userOverrides":[
 {"userId":"20000000-0000-4000-8000-000000000074","menu":"timetable","access":"full"},
 {"userId":"20000000-0000-4000-8000-000000000074","menu":"classes","access":"full"}]}}'
 where tenant_id='10000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000074"}',true);
set local role authenticated;
select ok(public.auth_can_use_timetable_lab(),'personal grants open both required menus');
select lives_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000074','Teacher','{"cells":[],"placements":[],"students":{}}',0,0,0)$q$,'teacher with both full grants saves');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,userOverrides,1,access}','"readonly"')
 where tenant_id='10000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000074"}',true);
set local role authenticated;
select ok(not public.auth_can_use_timetable_lab(),'revoking one menu closes access');
select is((select count(*)::int from public.timetable_lab_drafts),0,'revoked owner cannot read previously saved snapshot');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000075"}',true);
set local role authenticated;
select ok(not public.auth_can_use_timetable_lab(),'inactive user blocked with an existing JWT');
reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000076"}',true);
set local role authenticated;
select ok(not public.auth_can_use_timetable_lab(),'student blocked');

reset role;
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000071"}',true);
set local role authenticated;
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071','Foreign source','{"cells":[],"placements":[],"students":{},"source":{"tenantId":"10000000-0000-4000-8000-000000000072"}}',0,0,0)$q$,'23514',null,'foreign source rejected at DB too');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071','Missing source tenant','{"cells":[],"placements":[],"students":{},"source":{}}',0,0,0)$q$,'23514',null,'null source tenant cannot bypass check');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071','Invalid','{}',0,0,0)$q$,'23514',null,'missing snapshot keys blocked');
select throws_ok($q$insert into public.timetable_lab_drafts(tenant_id,created_by,name,snapshot,lesson_count,class_count,student_count)
 values ('10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071','Too large',jsonb_build_object('cells',jsonb_build_array(repeat('x',2097152)),'placements','[]'::jsonb,'students','{}'::jsonb),0,0,0)$q$,'23514',null,'oversized snapshot blocked');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data='{"permissions":{"overrides":[{"menu":"classes","role":"admin","access":"full"},{"menu":"classes","role":"admin","access":"readonly"}]}}'
 where tenant_id='10000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000071"}',true);
set local role authenticated;
select ok(not public.auth_can_use_timetable_lab(),'last role override wins');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.tenant_settings set data=jsonb_set(data,'{permissions,overrides,1,access}','"full"')
 where tenant_id='10000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000071"}',true);
set local role authenticated;
select ok(public.auth_can_use_timetable_lab(),'restored role grant opens access');
reset role;
select set_config('request.jwt.claims','{}',true);
insert into public.super_admins(id,email,display_name) values ('20000000-0000-4000-8000-000000000072','draft-peer@rls.test','Test super');
update public.tenant_settings set data=jsonb_set(data,'{permissions,overrides,1,access}','"none"')
 where tenant_id='10000000-0000-4000-8000-000000000071';
select set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000072"}',true);
set local role authenticated;
select ok(public.auth_can_use_timetable_lab(),'super admin keeps default full access after a branch override');
select is((select count(*)::int from public.timetable_lab_drafts),0,'super admin still cannot read another creator draft');
reset role;
select ok(not has_function_privilege('anon','public.auth_can_use_timetable_lab()','execute'),'anonymous cannot invoke private permission check');
select * from finish();
rollback;
