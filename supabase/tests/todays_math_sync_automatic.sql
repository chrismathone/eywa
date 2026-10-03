-- Isolated transactional coverage of installation trust and first-toggle onboarding.
begin;
do $$ begin if current_database()<>'eywa_source_test' then raise exception 'Fixture DB required'; end if; end $$;
insert into public.tenants(id,slug,name) values
 ('91000000-0000-4000-8000-000000000001','tm-auto-on','침산'),
 ('91000000-0000-4000-8000-000000000002','tm-auto-off','Same name'),
 ('91000000-0000-4000-8000-000000000003','tm-auto-expired','Expired'),
 ('91000000-0000-4000-8000-000000000004','tm-auto-excluded','Explicit mapping');
insert into public.tenant_licenses(tenant_id,feature,is_active,expires_at) values
 ('91000000-0000-4000-8000-000000000001','todays_math',true,null),
 ('91000000-0000-4000-8000-000000000002','todays_math',false,null),
 ('91000000-0000-4000-8000-000000000003','todays_math',true,now()-interval '1 second'),
 ('91000000-0000-4000-8000-000000000004','todays_math',true,null);
do $$
declare tid uuid:='91000000-0000-4000-8000-000000000001'; j jsonb; epoch uuid; generation bigint; n bigint;
begin
 assert not exists(select 1 from tm_sync_private.bindings where tenant_id=tid),'No automatic trust until explicitly configured';
 j:=public.tm_sync_configure_automatic(true,array['91000000-0000-4000-8000-000000000004'::uuid]);
 assert j @> jsonb_build_array(tid),'Discovers already ON tenant on first cron';
 j:=public.tm_sync_control(tid);
 assert j->>'targetBranchId'=tid::text and j->>'tenantName'='침산' and j->>'mode'='active' and (j->>'healthy')::boolean;
 assert not exists(select 1 from tm_sync_private.bindings where tenant_id in
  ('91000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000004')),'OFF expired and explicit tenants not provisioned';
 select source_epoch,tenant_generation into epoch,generation from tm_sync_private.bindings where id=tid;
 select count(*) into n from tm_sync_private.outbox where binding_id=tid;
 perform public.tm_sync_configure_automatic(true,array['91000000-0000-4000-8000-000000000004'::uuid]);
 assert (select count(*) from tm_sync_private.outbox where binding_id=tid)=n,'Idempotent bootstrap';
 update public.tenant_licenses set is_active=false where tenant_id=tid and feature='todays_math';
 assert not (public.tm_sync_control(tid)->>'enabled')::boolean,'OFF retained as authoritative state';
 assert (select source_epoch=epoch and tenant_generation>generation from tm_sync_private.bindings where id=tid),'OFF preserves identity and revokes generation';
 j:=public.tm_sync_configure_automatic(true,array['91000000-0000-4000-8000-000000000004'::uuid]);
 assert j @> jsonb_build_array(tid),'OFF binding retained in dispatch discovery';
 update public.tenant_licenses set is_active=true where tenant_id=tid and feature='todays_math';
 assert (select source_epoch=epoch from tm_sync_private.bindings where id=tid),'ON reuses existing epoch and branch';
 update public.tenants set name='침산 변경' where id=tid;
 assert public.tm_sync_control(tid)->>'tenantName'='침산 변경','Names come from source, not request data';
 -- A later tenant ON is captured in its own write transaction without another bootstrap.
 update public.tenant_licenses set is_active=true where tenant_id='91000000-0000-4000-8000-000000000002';
 assert exists(select 1 from tm_sync_private.bindings where id='91000000-0000-4000-8000-000000000002' and mode='active');
 assert exists(select 1 from tm_sync_private.outbox where binding_id='91000000-0000-4000-8000-000000000002');
 -- An operator shadow is never silently changed back by ordinary ON/reconcile.
 perform public.tm_sync_configure_binding(tid,tid,tid::text,'shadow',true);
 update public.tenant_licenses set is_active=false where tenant_id=tid;
 update public.tenant_licenses set is_active=true where tenant_id=tid;
 perform public.tm_sync_configure_automatic(true);
 assert public.tm_sync_control(tid)->>'mode'='shadow','Preserve explicit operator stop';
 assert not has_function_privilege('anon','public.tm_sync_configure_automatic(boolean,uuid[])','EXECUTE');
 assert not has_function_privilege('authenticated','public.tm_sync_configure_automatic(boolean,uuid[])','EXECUTE');
 assert has_function_privilege('service_role','public.tm_sync_configure_automatic(boolean,uuid[])','EXECUTE');
 assert (select relrowsecurity from pg_class where oid='tm_sync_private.automatic_settings'::regclass);
end; $$;
rollback;
