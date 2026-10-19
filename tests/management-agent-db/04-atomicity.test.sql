-- A notification failure must roll back case and event creation, so a later retry can recover.
insert into student_consultations(id,tenant_id,student_id,counselor_id,follow_up_date)
values('20000000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000032','20000000-0000-4000-8000-000000000011',current_date-1);
alter table notifications add constraint test_notification_failure
  check(tenant_id <> '20000000-0000-4000-8000-000000000001') not valid;
select throws_ok($$select management_agent_scan('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000022')$$,
  '23514',null,'failed notification aborts source event transaction');
select is((select count(*)::integer from management_cases where consultation_id='20000000-0000-4000-8000-000000000022'),0,'failed event leaves no silent unannounced case');
alter table notifications drop constraint test_notification_failure;
select management_agent_scan('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000022');
select is((select count(*)::integer from management_cases where consultation_id='20000000-0000-4000-8000-000000000022'),1,'retry creates exactly one case');
select is((select count(*)::integer from management_case_events where case_id in
  (select id from management_cases where consultation_id='20000000-0000-4000-8000-000000000022')),1,'retry creates exactly one detection event');
