begin;
-- Sequential synthetic scenarios; commits preserve pgTAP's transaction-local assertion counter.
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
update management_cases set created_at=now()-interval '5 days', acknowledged_at=null,last_reminded_on=null;
select management_agent_scan('10000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from management_case_events where case_id=current_setting('test.own_case')::uuid and kind='reminded'),1,'overdue unacknowledged case reminds once');
select management_agent_scan('10000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from management_case_events where case_id=current_setting('test.own_case')::uuid and kind='reminded'),1,'same-day scans do not spam');
update management_cases set last_reminded_on=current_date-2 where tenant_id=auth_tenant_id();
select management_agent_scan(auth_tenant_id());
select is((select count(*)::integer from management_case_events where case_id=current_setting('test.own_case')::uuid and kind='reminded'),1,'reminder interval respected');
update management_cases set last_reminded_on=current_date-4 where tenant_id=auth_tenant_id();
select management_agent_scan(auth_tenant_id());
select is((select count(*)::integer from management_case_events where case_id=current_setting('test.own_case')::uuid and kind='reminded'),2,'later reminder delivered');
update student_consultations set counselor_id='10000000-0000-4000-8000-000000000013' where tenant_id=auth_tenant_id();
select management_agent_scan(auth_tenant_id());
select is((select assignee_id::text from management_cases where tenant_id=auth_tenant_id()),'10000000-0000-4000-8000-000000000013','source owner change updates responsible person');
select is((select result_note from management_cases where tenant_id=auth_tenant_id()),null,'source change invalidates previous evidence');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000012',false);
select is((select count(*)::integer from management_cases),0,'old assignee loses access immediately');
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
delete from student_consultations where tenant_id=auth_tenant_id();
select management_agent_scan(auth_tenant_id());
select is((select status from management_cases where tenant_id=auth_tenant_id()),'blocked','deleted source is blocked, never resolved');
set role authenticated;
select management_case_command(id,version,'dismiss',null,'원본 삭제를 확인하여 검토에서 제외합니다') from management_cases;
reset role;
select management_agent_scan(auth_tenant_id());
select is((select status from management_cases where tenant_id=auth_tenant_id()),'dismissed','dismissal of missing source remains dismissed');
set role authenticated;
select throws_ok($$select management_case_save_advice(id,version,'{"summary":"상황","actions":[{}],"verification":"근거"}') from management_cases$$,'P0001',null,'malformed AI action item cannot be stored through RPC');
reset role;
update tenant_settings set data=jsonb_set(data,'{notifications,managementAgent,mode}','"off"') where tenant_id=auth_tenant_id();
set role authenticated;
select throws_ok($$select management_case_command(id,version,'reopen',null,'후속 관리를 다시 시작합니다') from management_cases$$,'P0001',null,'disabled mode rejects writes');
reset role;
select is(management_agent_scan(auth_tenant_id()),0,'disabled mode performs no scan changes');
commit;

begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
select is((select count(*)::integer from management_notion_claim(auth_tenant_id())),1,'delivery can be claimed once');
select is((select count(*)::integer from management_notion_claim(auth_tenant_id())),0,'concurrent caller cannot claim live delivery');
update management_notion_outbox set creation_started=true,updated_at=now()-interval '11 minutes' where tenant_id=auth_tenant_id();
select is((select count(*)::integer from management_notion_claim(auth_tenant_id())),1,'crashed claim can be reconciled later');
select ok((select creation_started from management_notion_outbox where tenant_id=auth_tenant_id()),'ambiguous creation intent survives crash recovery');
commit;

begin;
update tenant_settings set data=jsonb_set(data,'{notifications,managementAgent,mode}','"observe"')
  where tenant_id='10000000-0000-4000-8000-000000000001';
insert into student_consultations(id,tenant_id,student_id,counselor_id,follow_up_date)
select gen_random_uuid(),'10000000-0000-4000-8000-000000000001',gen_random_uuid(),
  '10000000-0000-4000-8000-000000000012',current_date-1 from generate_series(1,1005);
select management_agent_scan('10000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from management_cases where tenant_id='10000000-0000-4000-8000-000000000001'),1006,'scan handles more than 1000 sources without silent truncation');
commit;
