begin;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000012',false);
select is(management_agent_access(),'scoped','teacher defaults work without shared catalogue consultation entry');
select is(auth_menu_access('consultations'),'none','legacy shared helper deliberately does not grant access');
update users set system_role='counselor' where id=auth.uid();
select is(management_agent_access(),'full','counselor gets existing consultation default');
update users set system_role='manager' where id=auth.uid();
select is(management_agent_access(),'full','manager gets existing consultation default');
update users set system_role='accountant' where id=auth.uid();
select is(management_agent_access(),'none','accounting does not imply consultation access');
update users set system_role='teacher' where id=auth.uid();
update tenant_settings set data=jsonb_set(data,'{permissions}','{
  "overrides":[{"menu":"consultations","role":"teacher","access":"full"},{"menu":"consultations","role":"teacher","access":"none"}],
  "userOverrides":[]
}') where tenant_id=auth_tenant_id();
select is(management_agent_access(),'none','last valid role override wins');
update tenant_settings set data=jsonb_set(data,'{permissions,userOverrides}','[
  {"menu":"consultations","userId":"10000000-0000-4000-8000-000000000012","access":"full"},
  {"menu":"consultations","userId":"10000000-0000-4000-8000-000000000012","access":"readonly"},
  {"menu":"billing","userId":"10000000-0000-4000-8000-000000000012","access":"full"},
  {"menu":"consultations","userId":"10000000-0000-4000-8000-000000000013","access":"full"}
]') where tenant_id=auth_tenant_id();
select is(management_agent_access(),'readonly','last matching personal override wins over role; other person/menu ignored');
update users set system_role='student' where id=auth.uid();
select is(management_agent_access(),'none','student role is locked against personal grants');
update users set system_role='teacher' where id=auth.uid();
update users set status='inactive' where id=auth.uid();
select is(management_agent_access(),'none','inactive staff lose permission even with explicit grant');
update users set status='active' where id=auth.uid();
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000011',false);
select is(management_agent_access(),'full','other academy owner is independent of local overrides');
update tenant_settings set data=jsonb_set(data,'{permissions}','{
  "overrides":[{"menu":"consultations","role":"master","access":"none"}],"userOverrides":[]
}') where tenant_id=auth_tenant_id();
select is(management_agent_access(),'none','consultations owner override is respected like the application gate');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000099',false);
select is(management_agent_access(),'none','missing actor fails closed');
select set_config('request.jwt.claim.sub','',false);
select is(management_agent_access(),'none','no identity fails closed');
commit;
