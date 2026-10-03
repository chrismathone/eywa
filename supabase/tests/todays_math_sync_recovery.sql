-- Additional destructive fixture cases, strictly isolated and rolled back.
begin;
do $$ begin if current_database()<>'eywa_source_test' then raise exception 'Fixture DB required'; end if; end $$;
insert into public.students(id,tenant_id,name,status)
 select ('51000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001','Paging fixture '||n,'enrolled'
 from generate_series(1,205) n;
insert into public.enrollments(tenant_id,student_id,class_id,start_date)
 select '10000000-0000-0000-0000-000000000001',id,'40000000-0000-0000-0000-000000000001',(now() at time zone 'Asia/Seoul')::date
 from public.students where id::text like '51000000-%';
do $$
declare m jsonb; p jsonb; n integer;
begin
 m:=public.tm_sync_create_snapshot('30000000-0000-0000-0000-000000000001');
 assert m#>>'{collections,students,total}'='207','All pages count without truncation';
 assert jsonb_array_length(m#>'{collections,students,pages}')=3,'100/100/7 pages';
 for n in 0..2 loop
  p:=public.tm_sync_snapshot_page('30000000-0000-0000-0000-000000000001',(m->>'snapshotId')::uuid,'students',n);
  assert jsonb_array_length((p->>'json')::jsonb)=case when n=2 then 7 else 100 end;
  assert p->>'sha256'=tm_sync_private.hash(p->>'json');
 end loop;
end; $$;
do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; u uuid:='20000000-0000-0000-0000-000000000001';
 j jsonb; gen bigint; revision bigint; trigger_ddl text; n bigint;
begin
 -- A bypassed roster write is caught even after the trigger is reenabled.
 update tm_sync_private.bindings set last_reconciled_at=now()-interval '6 minutes' where id=b;
 perform public.tm_sync_reconcile();
 alter table public.enrollments disable trigger tm_sync_security;
 update public.enrollments set on_hold=not on_hold where id='60000000-0000-0000-0000-000000000001';
 alter table public.enrollments enable trigger tm_sync_security;
 update tm_sync_private.bindings set last_reconciled_at=now()-interval '6 minutes' where id=b;
 perform public.tm_sync_reconcile();
 assert not (public.tm_sync_control(b)->>'healthy')::boolean,'Unrecorded enrollment change latches history gap';
 perform public.tm_sync_recover_binding(b,(public.tm_sync_control(b)->>'sourceEpoch')::uuid);
 -- Class-only date transitions must not revoke the account/tenant session axis.
 perform public.tm_sync_reconcile();
 j:=public.tm_sync_control(b); gen:=(j->>'tenantRevocationGeneration')::bigint; revision:=(j->>'securityRevision')::bigint;
 update tm_sync_private.bindings set last_next_effective_at=now()-interval '1 second',last_control_hash='pre-boundary-fixture' where id=b;
 perform public.tm_sync_reconcile();
 j:=public.tm_sync_control(b);
 assert (j->>'tenantRevocationGeneration')::bigint=gen,'Class effective boundary leaves login generation unchanged';
 assert (j->>'securityRevision')::bigint>revision,'Class effective boundary advances permissions';
 assert (j->>'healthy')::boolean;
 update public.tenant_licenses set expires_at=now()-interval '1 second' where tenant_id='10000000-0000-0000-0000-000000000001' and feature='todays_math';
 assert not (public.tm_sync_control(b)->>'enabled')::boolean,'License expiry checked by current control, not cron';
 update public.tenant_licenses set expires_at=null where tenant_id='10000000-0000-0000-0000-000000000001' and feature='todays_math';
 update auth.users set deleted_at=now() where id=u;
 assert not (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Auth soft deletion blocks immediately';
 update auth.users set deleted_at=null where id=u;
 update auth.users set role='anon' where id=u;
 assert not (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Auth role cannot bypass source qualification';
 update auth.users set role='authenticated' where id=u;
 assert public.tm_sync_issue_code(b,u,repeat('1',64),repeat('2',64),repeat('X',43));
 update tm_sync_private.codes set expires_at=now()-interval '1 second' where code_hash=repeat('1',64);
 assert public.tm_sync_redeem_code(b,repeat('1',64),repeat('2',64),repeat('X',43)) is null,'Expired code rejected';
 j:=public.tm_sync_create_snapshot(b);
 update tm_sync_private.snapshots set expires_at=now()-interval '1 second' where id=(j->>'snapshotId')::uuid;
 assert public.tm_sync_snapshot_page(b,(j->>'snapshotId')::uuid,'classes',0) is null,'Expired page rejected';
 select pg_get_triggerdef(oid) into trigger_ddl from pg_trigger where tgrelid='public.users'::regclass and tgname='tm_sync_security';
 drop trigger tm_sync_security on public.users;
 assert not (public.tm_sync_schema_health()->>'healthy')::boolean,'Missing trigger fails health';
 execute trigger_ddl;
 assert (public.tm_sync_schema_health()->>'healthy')::boolean,'Restored exact trigger contract valid';
 delete from public.tenants where id='10000000-0000-0000-0000-000000000002';
 assert exists(select 1 from tm_sync_private.bindings where id='30000000-0000-0000-0000-000000000002'),'Source tenant deletion preserves binding';
 assert not (public.tm_sync_control('30000000-0000-0000-0000-000000000002')->>'enabled')::boolean,'Deleted source tenant returns OFF';
 assert exists(select 1 from tm_sync_private.outbox where binding_id='30000000-0000-0000-0000-000000000002' and kind='security'),'Deletion event survives source cascade';
 select count(*) into n from tm_sync_private.user_state;
 update tm_sync_private.nonces set expires_at=now()-interval '1 day';
 update tm_sync_private.codes set expires_at=now()-interval '2 days';
 update tm_sync_private.snapshots set expires_at=now()-interval '2 days';
 perform public.tm_sync_reconcile();
 assert not exists(select 1 from tm_sync_private.nonces),'Expired nonce cleanup';
 assert not exists(select 1 from tm_sync_private.codes),'Expired code cleanup';
 assert not exists(select 1 from tm_sync_private.snapshots),'Expired snapshot cleanup';
 assert (select count(*) from tm_sync_private.user_state)=n,'Cleanup never drops security tombstones';
end; $$;

-- Plain PostgreSQL has no pg_net extension. This typed SQL queue fixture checks
-- our configuration, arguments, dedupe, and failure boundary, not HTTP delivery.
create schema net;
create table net.fixture_requests(id bigint generated always as identity,url text,body jsonb,headers jsonb);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language plpgsql as $$
declare rid bigint;
begin
 insert into net.fixture_requests(url,body,headers) values(url,body,headers) returning id into rid;
 return rid;
end; $$;
do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; j jsonb; gen bigint; n bigint;
begin
 j:=public.tm_sync_configure_wake('https://fixture-source.example',repeat('fixture-',5));
 assert not (j->>'configured')::boolean,'Wake config defaults to preview';
 assert not exists(select 1 from tm_sync_private.wake_config);
 perform public.tm_sync_configure_wake('https://fixture-source.example',repeat('fixture-',5),true);
 update public.users set status='inactive' where id='20000000-0000-0000-0000-000000000001';
 update public.users set status='active' where id='20000000-0000-0000-0000-000000000001';
 assert (select count(*) from net.fixture_requests)=1,'One best-effort wake per binding/source transaction';
 assert (select url='https://fixture-source.example/api/cron/todays-math-sync' from net.fixture_requests),'Fixed source dispatcher path';
 assert (select body=jsonb_build_object('bindingId',b) from net.fixture_requests),'Wake never includes business PII';
 assert public.tm_sync_status()::text not like '%fixture-fixture-%','Operational status never includes wake secret';
 begin perform public.tm_sync_configure_wake('https://fixture.example/attacker',repeat('x',32),true); raise exception 'Invalid wake accepted';
 exception when raise_exception then assert sqlerrm='Fixed HTTPS source origin required'; end;
end; $$;
create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 2000)
returns bigint language plpgsql as $$ begin raise exception 'HTTP queue unavailable'; end $$;
delete from tm_sync_private.wake_transactions;
do $$
declare revision bigint; b uuid:='30000000-0000-0000-0000-000000000001';
begin
 revision:=(public.tm_sync_control(b)->>'securityRevision')::bigint;
 update public.users set status='inactive' where id='20000000-0000-0000-0000-000000000001';
 assert (select status='inactive' from public.users where id='20000000-0000-0000-0000-000000000001'),'HTTP failure does not roll back source';
 assert (public.tm_sync_control(b)->>'securityRevision')::bigint>revision,'HTTP failure preserves mandatory revision';
 assert exists(select 1 from tm_sync_private.outbox where binding_id=b and event->>'securityRevision'=(public.tm_sync_control(b)->>'securityRevision')),'HTTP failure preserves durable outbox';
end; $$;
rollback;
