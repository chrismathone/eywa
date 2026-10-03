-- Run only in the disposable eywa_source_test database after source migrations.
-- Assertions intentionally cover behavior and rollback, not implementation text.
begin;
do $$ begin if current_database()<>'eywa_source_test' then raise exception 'Fixture DB required'; end if; end $$;

insert into public.tenants(id,slug,name) values
 ('10000000-0000-0000-0000-000000000001','tm-fixture-a','Fixture A'),
 ('10000000-0000-0000-0000-000000000002','tm-fixture-b','Fixture B'),
 ('10000000-0000-0000-0000-000000000003','tm-fixture-unbound','Unbound');
insert into public.tenant_licenses(tenant_id,feature,is_active)
 select id,'todays_math',true from public.tenants;
insert into auth.users(id,email) select ('20000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'fixture'||n||'@example.invalid' from generate_series(1,7) n;
insert into public.users(id,tenant_id,email,display_name,system_role,status,subjects)
 select id,'10000000-0000-0000-0000-000000000001',email,'Fixture '||right(id::text,1),
  'teacher',case when right(id::text,1)='5' then 'pending'::public.user_status else 'active'::public.user_status end,
  case when right(id::text,1)='4' then array['english'] else array['math'] end
 from auth.users;
insert into public.super_admins(id,email,display_name)
 values('20000000-0000-0000-0000-000000000006','fixture6@example.invalid','Protected Fixture');

do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; t uuid:='10000000-0000-0000-0000-000000000001'; j jsonb;
begin
 assert (select count(*) from tm_sync_private.outbox)=0,'Unbound source writes must not enqueue';
 j:=public.tm_sync_configure_binding(b,t,'target-cuid-a');
 assert not (j->>'applied')::boolean and not exists(select 1 from tm_sync_private.bindings),'Config defaults to dry run';
 begin
  perform public.tm_sync_configure_binding(b,t,'target-cuid-a','active',true);
  raise exception 'Unexpected active first binding';
 exception when raise_exception then assert sqlerrm='New bindings must start in shadow'; end;
 perform public.tm_sync_configure_binding(b,t,'target-cuid-a','shadow',true);
 assert (public.tm_sync_schema_health()->>'healthy')::boolean,'All critical triggers required and valid';
 j:=public.tm_sync_control(b);
 assert j->>'mode'='shadow' and (j->>'enabled')::boolean,'Enabled shadow is observational';
 assert jsonb_array_length(j->'users')=6,'Protected recovery account excluded';
 assert not public.tm_sync_issue_code(b,'20000000-0000-0000-0000-000000000001',repeat('a',64),repeat('b',64),repeat('c',43)),'Shadow does not issue login codes';
 perform public.tm_sync_configure_binding(b,t,'target-cuid-a','active',true);
 perform public.tm_sync_configure_binding('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','target-cuid-b','shadow',true);
 begin
  perform public.tm_sync_configure_binding(b,t,'different-target','shadow',true);
  raise exception 'Unexpected mutable mapping';
 exception when raise_exception then assert sqlerrm='Binding identity is immutable'; end;
 assert (public.tm_sync_control(b,'20000000-0000-0000-0000-000000000001')#>>'{users,0,eligible}')::boolean,'Active math teacher eligible';
 assert not (public.tm_sync_control(b,'20000000-0000-0000-0000-000000000004')#>>'{users,0,eligible}')::boolean,'English only rejected';
 assert not (public.tm_sync_control(b,'20000000-0000-0000-0000-000000000005')#>>'{users,0,eligible}')::boolean,'Pending rejected';
 assert jsonb_array_length(public.tm_sync_control(b,'20000000-0000-0000-0000-000000000006')->'users')=0,'Protected ID not onboarded';
 assert jsonb_array_length(public.tm_sync_control(b,'20000000-0000-0000-0000-000000000001')#>'{users,0,classes}')=0,'Unassigned math teacher remains eligible';
end; $$;

insert into public.classes(id,tenant_id,class_name,subject,teacher_id) values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Math A','math','20000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Math B','math','20000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','English A','english','20000000-0000-0000-0000-000000000004'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Ended term','math','20000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','Other branch','math',null);
insert into public.class_schedules(id,tenant_id,class_id,teacher_id,day_of_week,start_time,end_time,valid_from,valid_to,created_at) values
 ('41000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','mon','15:00','16:00',(now() at time zone 'Asia/Seoul')::date-10,null,now()-interval '20 days'),
 ('41000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','tue','15:00','16:00',(now() at time zone 'Asia/Seoul')::date+10,null,now()),
 ('41000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','wed','15:00','16:00',(now() at time zone 'Asia/Seoul')::date-10,(now() at time zone 'Asia/Seoul')::date-1,now()-interval '20 days');
insert into public.class_delegations(id,tenant_id,class_id,delegate_user_id,from_date,to_date) values
 ('42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003',(now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date);
insert into public.students(id,tenant_id,name,status,is_test,parent_phone,school,grade) values
 ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Same Name','enrolled',false,'DO_NOT_EXPORT','Fixture School','7'),
 ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Same Name','on_hold',false,'DO_NOT_EXPORT','Fixture School','8'),
 ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Test Student','enrolled',true,'DO_NOT_EXPORT','Fixture School','9');
insert into public.enrollments(id,tenant_id,student_id,class_id,start_date,end_date,on_hold,is_transferred,attendance_days) values
 ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',(now() at time zone 'Asia/Seoul')::date-10,(now() at time zone 'Asia/Seoul')::date,false,false,array['mon']),
 ('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',(now() at time zone 'Asia/Seoul')::date-10,(now() at time zone 'Asia/Seoul')::date,false,true,'{}'),
 ('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001',(now() at time zone 'Asia/Seoul')::date+1,null,true,false,'{}'),
 ('60000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000001',(now() at time zone 'Asia/Seoul')::date-1,null,false,false,'{}');
insert into public.lesson_reports(id,tenant_id,student_id,class_id,subject,report_date,progress,notes) values
 ('70000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','math',(now() at time zone 'Asia/Seoul')::date,'분수 1단원','PRIVATE NOTE'),
 ('70000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000003','english',(now() at time zone 'Asia/Seoul')::date,'English private progress','PRIVATE NOTE');

do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; u uuid:='20000000-0000-0000-0000-000000000001';
 c jsonb; j jsonb; m jsonb; p jsonb; n bigint; rev bigint; gen bigint; before_page text; kind text;
begin
 c:=public.tm_sync_control(b); assert (c->>'healthy')::boolean;
 j:=public.tm_sync_control(b,'20000000-0000-0000-0000-000000000003');
 assert jsonb_array_length(j#>'{users,0,classes}')=1,'Future slot cannot grant today';
 assert jsonb_array_length(j#>'{users,0,classes,0,capabilities}')=4,'Delegate has only read capabilities';
 assert not ((j#>'{users,0,classes,0,capabilities}') ? 'test:write'),'No delegate writes';
 assert j#>>'{users,0,classes,0,validUntil}'=tm_sync_private.iso((((now() at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul')),'Inclusive delegation ends at next KST midnight';
 assert jsonb_array_length(public.tm_sync_control(b,u)#>'{users,0,classes}')=1,'Ended class period excludes current access';
 rev:=(c->>'securityRevision')::bigint; select count(*) into n from tm_sync_private.outbox;
 update public.users set status=status,subjects=subjects where id=u;
 update auth.users set encrypted_password='fixture-reset',last_sign_in_at=now(),raw_app_meta_data=jsonb_build_object('tenant_id','10000000-0000-0000-0000-000000000001') where id=u;
 assert (select count(*) from tm_sync_private.outbox)=n,'Mirror and password updates must not churn outbox';
 assert (public.tm_sync_control(b)->>'securityRevision')::bigint=rev,'No-op revision unchanged';
 update public.users set display_name='New Fixture Name' where id=u;
 update public.students set school='New Fixture School' where id='50000000-0000-0000-0000-000000000001';
 assert (public.tm_sync_control(b)->>'securityRevision')::bigint=rev,'Profiles use content lane only';
 gen:=(public.tm_sync_control(b,u)#>>'{users,0,accountRevocationGeneration}')::bigint;
 update public.classes set pending_teacher_id='20000000-0000-0000-0000-000000000002',pending_teacher_date=(now() at time zone 'Asia/Seoul')::date-2 where id='40000000-0000-0000-0000-000000000001';
 assert jsonb_array_length(public.tm_sync_control(b,u)#>'{users,0,classes}')=1,'Past pending handover does not replace homeroom';
 assert (public.tm_sync_control(b,u)#>>'{users,0,accountRevocationGeneration}')::bigint=gen,'Relationship changes do not revoke login generation';
 m:=public.tm_sync_create_snapshot(b);
 assert m->>'complete'='true' and m->>'securityRevision'=m#>>'{control,securityRevision}','Consistent manifest control';
 assert (m#>>'{collections,students,total}')::int=2,'Test students excluded, duplicate names retain identities';
 assert (m#>>'{collections,enrollments,total}')::int=3,'Hold and future memberships retained';
 assert (m#>>'{collections,classes,total}')::int=3,'Only source tenant math classes exported';
 assert (m#>>'{collections,progress,total}')::int=1,'English reports never exported';
 foreach kind in array array['staff','classes','memberships','students','enrollments','progress'] loop
  p:=public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,kind,0);
  assert p->>'sha256'=tm_sync_private.hash(p->>'json'),'Hash exact stored UTF8 string';
  assert not (p->>'json' like '%DO_NOT_EXPORT%' or p->>'json' like '%PRIVATE NOTE%'),'No unnecessary PII export';
 end loop;
 p:=public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,'progress',0); before_page:=p->>'json';
 update public.lesson_reports set progress='Later progress' where id='70000000-0000-0000-0000-000000000001';
 assert public.tm_sync_snapshot_page(b,(m->>'snapshotId')::uuid,'progress',0)->>'json'=before_page,'Page frozen across live changes';
 assert public.tm_sync_snapshot_page('30000000-0000-0000-0000-000000000002',(m->>'snapshotId')::uuid,'progress',0) is null,'Wrong binding cannot fetch snapshot';
 j:=public.tm_sync_create_snapshot('30000000-0000-0000-0000-000000000002');
 assert j#>>'{collections,students,total}'='0' and j#>'{collections,students,pages}'='[]','Empty collection is explicit';
 assert public.tm_sync_consume_nonce(b,'80000000-0000-0000-0000-000000000001',clock_timestamp()+interval '60 seconds');
 assert not public.tm_sync_consume_nonce(b,'80000000-0000-0000-0000-000000000001',clock_timestamp()+interval '60 seconds'),'Nonce replay rejected';
 assert public.tm_sync_issue_code(b,u,repeat('a',64),repeat('b',64),repeat('c',43));
 assert public.tm_sync_redeem_code(b,repeat('a',64),repeat('b',64),repeat('d',43)) is null,'Wrong PKCE rejected';
 j:=public.tm_sync_exchange_code(b,repeat('a',64),repeat('b',64),repeat('c',43),'80000000-0000-0000-0000-000000000002',clock_timestamp()+interval '60 seconds');
 assert j is not null and j->>'jti' is not null,'Correct one-time exchange';
 assert public.tm_sync_redeem_code(b,repeat('a',64),repeat('b',64),repeat('c',43)) is null,'Code second redemption rejected';
 assert not public.tm_sync_consume_nonce(b,'80000000-0000-0000-0000-000000000002',clock_timestamp()+interval '60 seconds'),'Exchange consumed its nonce';
 assert public.tm_sync_issue_code(b,u,repeat('d',64),repeat('b',64),repeat('c',43));
 gen:=(public.tm_sync_control(b)->>'tenantRevocationGeneration')::bigint;
 update public.tenant_licenses set is_active=false where tenant_id='10000000-0000-0000-0000-000000000001';
 j:=public.tm_sync_control(b,u);
 assert not (j->>'enabled')::boolean and not (j#>>'{users,0,eligible}')::boolean,'Control returns OFF even while export unavailable';
 begin perform public.tm_sync_create_snapshot(b); raise exception 'Unexpected OFF snapshot';
 exception when sqlstate 'PTS03' then null; end;
 update public.tenant_licenses set is_active=true where tenant_id='10000000-0000-0000-0000-000000000001';
 assert (public.tm_sync_control(b)->>'tenantRevocationGeneration')::bigint=gen+2,'OFF ON cannot resurrect old generation';
 assert public.tm_sync_redeem_code(b,repeat('d',64),repeat('b',64),repeat('c',43)) is null,'Pre-OFF code invalid after ON';
 update auth.users set banned_until=now()+interval '1 hour' where id=u;
 assert not (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Auth ban in current control';
 update auth.users set banned_until=null where id=u;
 assert (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Ban removal rechecks qualification';
 update public.users set status='inactive' where id=u;
 assert not (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Employment inactive';
 update public.users set status='active',subjects=array['english'] where id=u;
 assert not (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Math exit';
 update public.users set subjects=array['math','english'] where id=u;
 assert (public.tm_sync_control(b,u)#>>'{users,0,eligible}')::boolean,'Mixed teacher eligible';
end; $$;

-- Fault injection: loss of mandatory outbox MUST roll back the source write and
-- revision. Loss of best-effort content metadata MUST preserve the report write.
create function public.tm_fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'injected'; end $$;
create trigger tm_fixture_outbox_failure before insert on tm_sync_private.outbox for each row execute function public.tm_fixture_fail();
do $$
declare rev bigint;
begin
 select security_revision into rev from tm_sync_private.bindings where id='30000000-0000-0000-0000-000000000001';
 begin update public.users set status='inactive' where id='20000000-0000-0000-0000-000000000001'; raise exception 'Unexpected commit';
 exception when sqlstate 'PTS01' then null; end;
 assert (select status='active' from public.users where id='20000000-0000-0000-0000-000000000001'),'Mandatory failure rolls back business row';
 assert (select security_revision=rev from tm_sync_private.bindings where id='30000000-0000-0000-0000-000000000001'),'Mandatory failure rolls back revision';
end; $$;
drop trigger tm_fixture_outbox_failure on tm_sync_private.outbox;
create trigger tm_fixture_content_failure before insert or update on tm_sync_private.content_dirty for each row execute function public.tm_fixture_fail();
update public.lesson_reports set progress='Survived notification failure' where id='70000000-0000-0000-0000-000000000001';
do $$ begin assert (select progress='Survived notification failure' from public.lesson_reports where id='70000000-0000-0000-0000-000000000001'); end $$;
drop trigger tm_fixture_content_failure on tm_sync_private.content_dirty;
drop function public.tm_fixture_fail();

do $$
declare b uuid:='30000000-0000-0000-0000-000000000001'; j jsonb; item jsonb; eid uuid; token uuid; gen bigint; rev1 bigint; rev2 bigint;
begin
 perform public.tm_sync_reconcile();
 assert exists(select 1 from tm_sync_private.outbox where binding_id=b and kind='content'),'Reconcile recovers content work';
 j:=public.tm_sync_claim_events(1); assert jsonb_array_length(j)=1;
 item:=j->0; eid:=(item#>>'{event,eventId}')::uuid; token:=(item->>'leaseToken')::uuid;
 assert not public.tm_sync_finish_event(eid,gen_random_uuid(),'applied'),'Wrong lease fenced';
 update tm_sync_private.outbox set lease_until=clock_timestamp()-interval '1 second' where id=eid;
 assert not public.tm_sync_finish_event(eid,token,'applied'),'Expired lease fenced';
 assert not public.tm_sync_finish_event(eid,token,'conflict'),'Expired lease cannot conflict new worker';
 update tm_sync_private.outbox set available_at=clock_timestamp()-interval '1 hour' where id=eid;
 j:=public.tm_sync_claim_events(1); assert (j#>>'{0,event,eventId}')::uuid=eid;
 assert (j#>>'{0,leaseToken}')::uuid<>token,'Reclaim uses new token';
 token:=(j#>>'{0,leaseToken}')::uuid;
 assert public.tm_sync_finish_event(eid,token,'received'),'Received is distinct from applied';
 assert (select status='received' and finished_at is null from tm_sync_private.outbox where id=eid);
 update tm_sync_private.outbox set available_at=clock_timestamp()-interval '1 hour' where id=eid;
 j:=public.tm_sync_claim_events(1);
 assert public.tm_sync_finish_event(eid,(j#>>'{0,leaseToken}')::uuid,'applied');
 assert (select last_success_at is not null from tm_sync_private.bindings where id=b);
 gen:=(public.tm_sync_control(b)->>'tenantRevocationGeneration')::bigint;
 alter table public.class_delegations disable trigger tm_sync_security;
 assert not (public.tm_sync_control(b)->>'healthy')::boolean,'Disabled required trigger closes eligibility';
 assert not (public.tm_sync_control(b,'20000000-0000-0000-0000-000000000001')#>>'{users,0,eligible}')::boolean;
 perform public.tm_sync_reconcile();
 alter table public.class_delegations enable trigger tm_sync_security;
 assert not (public.tm_sync_control(b)->>'healthy')::boolean,'Reenabled trigger does not clear durable recording gap';
 j:=public.tm_sync_recover_binding(b,(public.tm_sync_control(b)->>'sourceEpoch')::uuid);
 assert (j->>'healthy')::boolean and (j->>'tenantRevocationGeneration')::bigint>=gen+2,'Explicit repair increments protection';
 -- A metadata change after baseline must not be misclassified as lost security.
 perform public.tm_sync_reconcile();
 update public.users set email='renamed@example.invalid' where id='20000000-0000-0000-0000-000000000001';
 update tm_sync_private.bindings set last_reconciled_at=clock_timestamp()-interval '6 minutes' where id=b;
 perform public.tm_sync_reconcile();
 assert (public.tm_sync_control(b)->>'healthy')::boolean,'Profile-only write does not create history gap';
 rev1:=(public.tm_sync_control(b)->>'securityRevision')::bigint;
 rev2:=(public.tm_sync_control('30000000-0000-0000-0000-000000000002')->>'securityRevision')::bigint;
 update public.users set tenant_id='10000000-0000-0000-0000-000000000002' where id='20000000-0000-0000-0000-000000000007';
 assert (public.tm_sync_control(b)->>'securityRevision')::bigint>rev1 and (public.tm_sync_control('30000000-0000-0000-0000-000000000002')->>'securityRevision')::bigint>rev2,'Both sides of tenant move recorded';
 delete from public.users where id='20000000-0000-0000-0000-000000000007';
 assert exists(select 1 from tm_sync_private.user_state where user_id='20000000-0000-0000-0000-000000000007' and deleted_at is not null),'Identity tombstone retained';
 begin truncate public.class_delegations; raise exception 'Unexpected truncate'; exception when sqlstate 'PTS01' then null; end;
 assert not has_function_privilege('anon','public.tm_sync_control(uuid,uuid)','EXECUTE');
 assert not has_function_privilege('authenticated','public.tm_sync_control(uuid,uuid)','EXECUTE');
 assert has_function_privilege('service_role','public.tm_sync_control(uuid,uuid)','EXECUTE');
 assert not has_schema_privilege('service_role','tm_sync_private','USAGE'),'No direct private state grants';
 assert not exists(select 1 from pg_tables where schemaname='tm_sync_private' and not rowsecurity),'RLS enabled on every private table';
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'tm_sync_%' and
   (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))),'All RPCs service-only';
end; $$;
set local role service_role;
select public.tm_sync_schema_health();
reset role;
commit;
