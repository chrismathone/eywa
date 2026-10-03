-- CLI provenance: npx --yes supabase@2.81.3 migration new todays_math_sync_v2
-- created 20261003083350_todays_math_sync_v2.sql; moved to the repository alpha
-- convention (README: previous maximum 0336). Additive; no live binding enabled.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema if not exists tm_sync_private;
revoke all on schema tm_sync_private from public, anon, authenticated, service_role;

-- These records deliberately have no FK to source identities: deletion must not
-- erase an OFF, a tombstone, a revocation generation, or an undelivered event.
create table if not exists tm_sync_private.bindings (
  id uuid primary key,
  tenant_id uuid not null unique,
  target_branch_id text not null unique check(length(target_branch_id) between 1 and 200),
  mode text not null default 'shadow' check (mode in ('shadow','active')),
  source_epoch uuid not null default gen_random_uuid(),
  security_revision bigint not null default 1 check (security_revision >= 0),
  tenant_generation bigint not null default 0 check (tenant_generation >= 0),
  history_gap boolean not null default false,
  last_control_hash text,
  last_audited_revision bigint,
  last_next_effective_at timestamptz,
  last_reconciled_at timestamptz,
  last_full_at timestamptz,
  last_content_hash text,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists tm_sync_private.user_state (
  binding_id uuid not null references tm_sync_private.bindings(id),
  user_id uuid not null,
  account_generation bigint not null default 0,
  class_list_revision bigint not null default 0,
  deleted_at timestamptz,
  primary key (binding_id,user_id)
);
create table if not exists tm_sync_private.class_state (
  binding_id uuid not null references tm_sync_private.bindings(id),
  class_id uuid not null,
  permission_revision bigint not null default 0,
  deleted_at timestamptz,
  primary key (binding_id,class_id)
);
create table if not exists tm_sync_private.export_state (
  binding_id uuid primary key references tm_sync_private.bindings(id),
  content_generation bigint not null default 0
);
create table if not exists tm_sync_private.content_dirty (
  binding_id uuid primary key references tm_sync_private.bindings(id),
  changed_at timestamptz not null default now()
);
create table if not exists tm_sync_private.outbox (
  id uuid primary key default gen_random_uuid(),
  binding_id uuid not null references tm_sync_private.bindings(id),
  event jsonb not null,
  kind text not null check(kind in ('security','content','reconcile')),
  status text not null default 'pending' check(status in ('pending','leased','received','applied','conflict','superseded','retry')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  occurred_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists tm_sync_outbox_due on tm_sync_private.outbox(available_at,occurred_at)
  where status in ('pending','leased','received','retry');
create index if not exists tm_sync_outbox_binding on tm_sync_private.outbox(binding_id,occurred_at);
create table if not exists tm_sync_private.nonces (
  binding_id uuid not null references tm_sync_private.bindings(id),
  nonce uuid not null,
  expires_at timestamptz not null,
  primary key(binding_id,nonce)
);
create table if not exists tm_sync_private.codes (
  binding_id uuid not null references tm_sync_private.bindings(id),
  code_hash text not null check(code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null,
  state_hash text not null check(state_hash ~ '^[0-9a-f]{64}$'),
  challenge text not null check(challenge ~ '^[A-Za-z0-9_-]{43}$'),
  source_epoch uuid not null,
  tenant_generation bigint not null,
  account_generation bigint not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  consumed_at timestamptz,
  primary key(binding_id,code_hash)
);
create table if not exists tm_sync_private.snapshots (
  id uuid primary key,
  binding_id uuid not null references tm_sync_private.bindings(id),
  manifest jsonb not null,
  expires_at timestamptz not null
);
create table if not exists tm_sync_private.pages (
  snapshot_id uuid not null references tm_sync_private.snapshots(id) on delete cascade,
  kind text not null check(kind in ('staff','classes','memberships','students','enrollments','progress')),
  page integer not null check(page >= 0),
  row_count integer not null,
  json_text text not null,
  sha256 text not null,
  primary key(snapshot_id,kind,page)
);
create table if not exists tm_sync_private.trigger_contract (
  relation_name text not null,
  trigger_name text not null,
  definition_hash text not null,
  function_hash text not null,
  primary key(relation_name,trigger_name)
);
create table if not exists tm_sync_private.function_contract (
 signature text primary key,
 definition_hash text not null
);
create table if not exists tm_sync_private.wake_config (
 singleton boolean primary key default true check(singleton),
 source_origin text not null,
 wake_secret text not null check(length(wake_secret)>=32)
);
create table if not exists tm_sync_private.wake_transactions (
 binding_id uuid primary key references tm_sync_private.bindings(id),
 transaction_id text not null
);

create or replace function tm_sync_private.wake(p_binding_id uuid)
returns void language plpgsql set search_path = '' as $$
declare cfg tm_sync_private.wake_config; claimed uuid;
begin
 select * into cfg from tm_sync_private.wake_config where singleton;
 if not found or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
 insert into tm_sync_private.wake_transactions(binding_id,transaction_id) values(p_binding_id,pg_current_xact_id()::text)
 on conflict(binding_id) do update set transaction_id=excluded.transaction_id
 where tm_sync_private.wake_transactions.transaction_id<>excluded.transaction_id returning binding_id into claimed;
 if claimed is null then return; end if;
 -- pg_net sends only after commit. Never send a business row or target secret.
 execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 3000)'
 using cfg.source_origin||'/api/cron/todays-math-sync',jsonb_build_object('bindingId',p_binding_id),
  jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||cfg.wake_secret);
exception when others then
 -- Keep this exception block below durable insertion in emit. HTTP/config/queue
 -- failure must not swallow a failed mandatory outbox write.
 return;
end; $$;

create or replace function tm_sync_private.iso(p_time timestamptz) returns text
language sql immutable set search_path = '' as $$
 select to_char(p_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;
create or replace function tm_sync_private.hash(p_text text) returns text
language sql immutable set search_path = '' as $$
 select encode(sha256(convert_to(p_text,'UTF8')),'hex');
$$;
create or replace function tm_sync_private.emit(p_binding_id uuid,p_kind text,p_type text,p_entity uuid)
returns uuid language plpgsql set search_path = '' as $$
declare b tm_sync_private.bindings; eid uuid := gen_random_uuid(); ts timestamptz := clock_timestamp();
begin
 select * into strict b from tm_sync_private.bindings where id=p_binding_id;
 insert into tm_sync_private.outbox(id,binding_id,kind,occurred_at,event)
 values(eid,b.id,p_kind,ts,jsonb_build_object(
  'schemaVersion',2,'eventId',eid,'bindingId',b.id,'tenantId',b.tenant_id,
  'sourceEpoch',b.source_epoch,'securityRevision',b.security_revision::text,
  'tenantRevocationGeneration',b.tenant_generation::text,
  'occurredAt',tm_sync_private.iso(ts),'kind',p_kind,'entityType',p_type,'entityId',p_entity));
 -- NOTIFY is transactional and carries no business row or credential. A server
 -- listener may wake the dispatcher; the minute cron is the durable fallback.
 perform pg_notify('tm_sync_wake',b.id::text);
 perform tm_sync_private.wake(b.id);
 return eid;
end; $$;

create or replace function tm_sync_private.healthy() returns boolean
language sql stable set search_path = '' as $$
 select (select count(*) from tm_sync_private.trigger_contract) = 20
 and not exists (
  select 1 from tm_sync_private.trigger_contract e
  left join pg_class c on c.oid=to_regclass(e.relation_name)
  left join pg_trigger t on t.tgrelid=c.oid and t.tgname=e.trigger_name and not t.tgisinternal
  where t.oid is null or t.tgenabled not in ('O','A')
    or tm_sync_private.hash(pg_get_triggerdef(t.oid)) <> e.definition_hash
    or tm_sync_private.hash(pg_get_functiondef(t.tgfoid)) <> e.function_hash
 ) and (select count(*) from tm_sync_private.function_contract)=11
 and not exists(select 1 from tm_sync_private.function_contract f
   where to_regprocedure(f.signature) is null
    or tm_sync_private.hash(pg_get_functiondef(to_regprocedure(f.signature)))<>f.definition_hash)
 and to_regprocedure('public.class_period_closed_end(uuid)') is not null;
$$;

-- Current membership rows and snapshot rows share this definition. Pending
-- handovers never become permissions until the source teacher_id actually moves.
create or replace function tm_sync_private.memberships(p_tenant uuid)
returns table(id uuid,class_id uuid,user_id uuid,member_role text,starts_on date,ends_on date,revoked_at timestamptz,capabilities text[])
language sql stable set search_path = '' as $$
 select md5(c.id::text||':'||c.teacher_id::text||':homeroom')::uuid,c.id,c.teacher_id,
  'homeroom'::text,null::date,c.closed_at,null::timestamptz,array['class:read','student:read','test:read','test:write','progress:read','progress:write','student:account']::text[]
 from public.classes c join public.users u on u.id=c.teacher_id and u.tenant_id=c.tenant_id
 where c.tenant_id=p_tenant and c.subject='math'
 union all
 select s.id,s.class_id,s.teacher_id,'slot',s.valid_from,s.valid_to,null::timestamptz,array['class:read','student:read','test:read','test:write','progress:read','progress:write','student:account']::text[]
 from public.class_schedules s join public.classes c on c.id=s.class_id and c.tenant_id=s.tenant_id
 join public.users u on u.id=s.teacher_id and u.tenant_id=s.tenant_id
 where s.tenant_id=p_tenant and c.subject='math'
 union all
 select d.id,d.class_id,d.delegate_user_id,'delegate',d.from_date,d.to_date,d.revoked_at,array['class:read','student:read','test:read','progress:read']::text[]
 from public.class_delegations d join public.classes c on c.id=d.class_id and c.tenant_id=d.tenant_id
 join public.users u on u.id=d.delegate_user_id and u.tenant_id=d.tenant_id
 where d.tenant_id=p_tenant and c.subject='math';
$$;

create or replace function tm_sync_private.next_effective(p_tenant uuid,p_now timestamptz)
returns timestamptz language sql stable set search_path = '' as $$
 select min(t) from (
  select l.expires_at t from public.tenant_licenses l where l.tenant_id=p_tenant and l.feature='todays_math'
  union all select a.banned_until from auth.users a join public.users u on u.id=a.id where u.tenant_id=p_tenant
  union all select (m.starts_on::timestamp at time zone 'Asia/Seoul') from tm_sync_private.memberships(p_tenant) m
  union all select ((m.ends_on+1)::timestamp at time zone 'Asia/Seoul') from tm_sync_private.memberships(p_tenant) m
  union all select ((c.closed_at+1)::timestamp at time zone 'Asia/Seoul') from public.classes c where c.tenant_id=p_tenant and c.subject='math'
  union all select ((s.valid_to+1)::timestamp at time zone 'Asia/Seoul') from public.class_schedules s where s.tenant_id=p_tenant
  union all select (s.valid_from::timestamp at time zone 'Asia/Seoul') from public.class_schedules s where s.tenant_id=p_tenant
  union all select (e.start_date::timestamp at time zone 'Asia/Seoul') from public.enrollments e where e.tenant_id=p_tenant
  union all select ((e.end_date+case when e.is_transferred then 0 else 1 end)::timestamp at time zone 'Asia/Seoul')
   from public.enrollments e where e.tenant_id=p_tenant
  union all select (s.withdrawn_at::timestamp at time zone 'Asia/Seoul') from public.students s where s.tenant_id=p_tenant
 ) q where t>p_now;
$$;

-- Profiles are metadata, never part of the mandatory recording-gap comparison.
create or replace function tm_sync_private.control_hash(p_control jsonb)
returns text language sql immutable set search_path = '' as $$
 select tm_sync_private.hash(((p_control-'validatedAt'-'nextEffectiveAt'-'securityRevision'-'tenantRevocationGeneration'-'users')
  ||jsonb_build_object('users',coalesce((select jsonb_agg(u.value-'email'-'name' order by u.value->>'id')
   from jsonb_array_elements(p_control->'users') u),'[]'::jsonb)))::text);
$$;

create or replace function public.tm_sync_control(p_binding_id uuid,p_user_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
 with b as materialized (
  select b.*,tm_sync_private.healthy() and not b.history_gap healthy,
   exists(select 1 from public.tenants t where t.id=b.tenant_id) and exists(
    select 1 from public.tenant_licenses l where l.tenant_id=b.tenant_id and l.feature='todays_math'
     and l.is_active and (l.expires_at is null or l.expires_at>statement_timestamp())
   ) enabled from tm_sync_private.bindings b where b.id=p_binding_id
 ), staff as (
  select u.*,us.account_generation,us.class_list_revision,b.enabled,b.healthy,
   array_remove(array[
    case when not b.enabled then 'tenant_disabled' end,
    case when not b.healthy then 'source_unhealthy' end,
    case when u.status::text<>'active' then 'staff_inactive' end,
    case when u.system_role::text not in ('teacher','manager','master','admin') then 'role_ineligible' end,
    case when not ('math'=any(coalesce(u.subjects,'{}'))) then 'subject_ineligible' end,
    case when a.id is null or a.deleted_at is not null then 'auth_unavailable' end,
    case when a.banned_until>statement_timestamp() then 'auth_banned' end,
    case when a.role is distinct from 'authenticated' then 'auth_role_ineligible' end
   ]::text[],null) reasons
  from b join public.users u on u.tenant_id=b.tenant_id
  left join auth.users a on a.id=u.id
  left join tm_sync_private.user_state us on us.binding_id=b.id and us.user_id=u.id
  where (p_user_id is null or u.id=p_user_id)
   and (u.system_role::text in ('teacher','manager','master','admin') or us.user_id is not null)
   and not exists(select 1 from public.super_admins protected where protected.id=u.id)
 ), access_rows as (
  select m.user_id,m.class_id,coalesce(cs.permission_revision,0) revision,
   cap.capability,
   -- An unbounded independently valid membership prevents a finite delegate
   -- end from shortening the durable homeroom permission.
   case when m.ends_on is null and c.closed_at is null then null else
    ((least(m.ends_on,c.closed_at)+1)::timestamp at time zone 'Asia/Seoul') end valid_until
  from b join tm_sync_private.memberships(b.tenant_id) m on true
  join public.classes c on c.id=m.class_id and c.tenant_id=b.tenant_id
  left join tm_sync_private.class_state cs on cs.binding_id=b.id and cs.class_id=m.class_id
  cross join lateral unnest(m.capabilities) cap(capability)
  where c.is_active and (c.closed_at is null or c.closed_at>=(statement_timestamp() at time zone 'Asia/Seoul')::date)
   and public.class_period_closed_end(c.id) is null and m.revoked_at is null
   and (m.starts_on is null or m.starts_on<=(statement_timestamp() at time zone 'Asia/Seoul')::date)
   and (m.ends_on is null or m.ends_on>=(statement_timestamp() at time zone 'Asia/Seoul')::date)
 ), grouped_access as (
  select user_id,class_id,revision,array_agg(distinct capability order by capability) caps,
   case when bool_or(valid_until is null) then null else max(valid_until) end valid_until
  from access_rows group by user_id,class_id,revision
 )
 select jsonb_build_object('schemaVersion',2,'bindingId',b.id,'tenantId',b.tenant_id,
  'tenantName',(select t.name from public.tenants t where t.id=b.tenant_id),
  'targetBranchId',b.target_branch_id,'sourceEpoch',b.source_epoch,'securityRevision',b.security_revision::text,
  'tenantRevocationGeneration',b.tenant_generation::text,'enabled',b.enabled,'mode',b.mode,
  'validatedAt',tm_sync_private.iso(statement_timestamp()),'nextEffectiveAt',tm_sync_private.iso(tm_sync_private.next_effective(b.tenant_id,statement_timestamp())),
  'healthy',b.healthy,'users',coalesce((select jsonb_agg(jsonb_build_object(
   'id',s.id,'email',s.email,'name',s.display_name,'status',s.status,'role',s.system_role,
   'subjects',coalesce(s.subjects,'{}'),'eligible',cardinality(s.reasons)=0,'blockReasons',s.reasons,
   'accountRevocationGeneration',coalesce(s.account_generation,0)::text,
   'classListRevision',coalesce(s.class_list_revision,0)::text,
   'classes',case when cardinality(s.reasons)>0 then '[]'::jsonb else coalesce((
     select jsonb_agg(jsonb_build_object('id',g.class_id,'permissionRevision',g.revision::text,
      'capabilities',g.caps,'validUntil',tm_sync_private.iso(g.valid_until)) order by g.class_id)
     from grouped_access g where g.user_id=s.id),'[]'::jsonb) end
  ) order by s.id) from staff s),'[]'::jsonb)) from b;
$$;

-- Five-minute security/roster audit excludes report contents and metadata. This
-- catches direct writes made with a disabled trigger even after it is reenabled.
create or replace function tm_sync_private.security_hash(p_binding_id uuid)
returns text language sql stable set search_path = '' as $$
 with b as (select tenant_id from tm_sync_private.bindings where id=p_binding_id)
 select tm_sync_private.hash(jsonb_build_object(
  'control',tm_sync_private.control_hash(public.tm_sync_control(p_binding_id)),
  'students',(select jsonb_agg(jsonb_build_array(s.id,s.status,s.is_test,s.withdrawn_at) order by s.id)
    from b join public.students s on s.tenant_id=b.tenant_id),
  'enrollments',(select jsonb_agg(jsonb_build_array(e.id,e.student_id,e.class_id,e.start_date,e.end_date,e.on_hold,e.is_transferred,e.attendance_days) order by e.id)
    from b join public.enrollments e on e.tenant_id=b.tenant_id),
  'classes',(select jsonb_agg(jsonb_build_array(c.id,c.subject,c.teacher_id,c.is_active,c.closed_at,c.pending_teacher_id,c.pending_teacher_date) order by c.id)
    from b join public.classes c on c.tenant_id=b.tenant_id),
  'schedules',(select jsonb_agg(jsonb_build_array(s.id,s.class_id,s.teacher_id,s.valid_from,s.valid_to,s.day_of_week,s.start_time,s.end_time) order by s.id)
    from b join public.class_schedules s on s.tenant_id=b.tenant_id),
  'delegations',(select jsonb_agg(jsonb_build_array(d.id,d.class_id,d.delegate_user_id,d.from_date,d.to_date,d.revoked_at) order by d.id)
    from b join public.class_delegations d on d.tenant_id=b.tenant_id)
 )::text);
$$;

-- STABLE is essential: the entire export and Control use the calling SELECT's
-- single MVCC snapshot, even at READ COMMITTED. No page re-reads live tables.
create or replace function tm_sync_private.export_rows(p_binding_id uuid)
returns jsonb language sql stable set search_path = '' as $$
 with b as (select * from tm_sync_private.bindings where id=p_binding_id),
 c as materialized (
  select c.*,coalesce(cs.permission_revision,0) permission_revision,public.class_period_closed_end(c.id) period_end
  from b join public.classes c on c.tenant_id=b.tenant_id and c.subject='math'
  left join tm_sync_private.class_state cs on cs.binding_id=b.id and cs.class_id=c.id
 ), st as materialized (
  select s.* from b join public.students s on s.tenant_id=b.tenant_id and not s.is_test
  where exists(select 1 from public.enrollments e join c on c.id=e.class_id
   where e.tenant_id=b.tenant_id and e.student_id=s.id)
 ), ctrl as (select public.tm_sync_control(p_binding_id) j)
 select jsonb_build_object('control',ctrl.j,'collections',jsonb_build_object(
 'staff',ctrl.j->'users',
 'classes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.class_name,'subject',c.subject,
   'grade',null,'active',c.is_active and c.period_end is null and (c.closed_at is null or c.closed_at>=(statement_timestamp() at time zone 'Asia/Seoul')::date),
   'closedAt',tm_sync_private.iso(((coalesce(c.closed_at,c.period_end)+1)::timestamp at time zone 'Asia/Seoul')),
   'teacherId',c.teacher_id,'permissionRevision',c.permission_revision::text) order by c.id) from c),'[]'::jsonb),
 'memberships',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'classId',m.class_id,'userId',m.user_id,
   'role',m.member_role,'startsOn',m.starts_on,'endsOn',m.ends_on,'revokedAt',tm_sync_private.iso(m.revoked_at),
   'capabilities',m.capabilities) order by m.id) from b cross join lateral tm_sync_private.memberships(b.tenant_id) m
   where not exists(select 1 from public.super_admins a where a.id=m.user_id)),'[]'::jsonb),
 'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'grade',s.grade,'school',s.school,
   'status',case when s.withdrawn_at<=(statement_timestamp() at time zone 'Asia/Seoul')::date then 'withdrawn' else s.status::text end,
   'isTest',s.is_test) order by s.id) from st s),'[]'::jsonb),
 'enrollments',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'studentId',e.student_id,'classId',e.class_id,
   'startsOn',e.start_date,'endsOn',case when e.end_date is null and e.start_date<=c.period_end then c.period_end else e.end_date end,
   'onHold',e.on_hold,'isTransferred',e.is_transferred,'attendanceDays',e.attendance_days) order by e.id)
   from b join public.enrollments e on e.tenant_id=b.tenant_id join c on c.id=e.class_id join st on st.id=e.student_id),'[]'::jsonb),
 'progress',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'studentId',r.student_id,'classId',r.class_id,
   'makeupClassId',r.makeup_class_id,'reportDate',r.report_date,'createdAt',tm_sync_private.iso(r.created_at),'progress',r.progress)
   order by r.report_date,r.created_at,r.id)
   from b join public.lesson_reports r on r.tenant_id=b.tenant_id join st on st.id=r.student_id
   where r.progress is not null and r.subject='math'
    and (r.class_id is null or exists(select 1 from c where c.id=r.class_id))
    and (r.makeup_class_id is null or exists(select 1 from c where c.id=r.makeup_class_id))),'[]'::jsonb)
 )) from ctrl;
$$;

-- Only explicitly selected source columns are examined; password/login/mirror
-- no-op updates and unrelated tenant licenses do not create security events.
create or replace function tm_sync_private.capture_security() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 n jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 fields text[]; k text; b tm_sync_private.bindings; tids uuid[]; cids uuid[] := '{}';
 uids uuid[] := '{}'; who uuid; cid uuid; same boolean := true; tenant_revoke boolean := false;
begin
 fields := string_to_array(tg_argv[0],',');
 if tg_op='UPDATE' then
  foreach k in array fields loop
   if o->k is distinct from n->k then same := false; exit; end if;
  end loop;
  if same then return new; end if;
 end if;
 if tg_table_name='tenant_licenses' and coalesce(o->>'feature','')<>'todays_math'
    and coalesce(n->>'feature','')<>'todays_math' then return coalesce(new,old); end if;
 if tg_table_name='tenant_licenses' and n->>'feature'='todays_math' and (n->>'is_active')::boolean
    and ((n->>'expires_at') is null or (n->>'expires_at')::timestamptz>statement_timestamp()) then
  perform tm_sync_private.ensure_auto_binding((n->>'tenant_id')::uuid);
 end if;
 if tg_table_schema='auth' or tg_table_name='super_admins' then
  who := coalesce((n->>'id')::uuid,(o->>'id')::uuid);
  select array_agg(distinct t) into tids from (
   select u.tenant_id t from public.users u where u.id=who
   union select b2.tenant_id from tm_sync_private.user_state us
    join tm_sync_private.bindings b2 on b2.id=us.binding_id where us.user_id=who
  ) q;
 elsif tg_table_name='tenants' then
  tids := array[coalesce((n->>'id')::uuid,(o->>'id')::uuid)];
  tenant_revoke := true;
 else
  tids := array[(o->>'tenant_id')::uuid,(n->>'tenant_id')::uuid];
 end if;
 if tg_table_name='users' then who:=coalesce((n->>'id')::uuid,(o->>'id')::uuid); end if;
 if tg_table_name='tenant_licenses' then tenant_revoke:=true; end if;
 if tg_table_name='classes' then
  cids := array[coalesce((n->>'id')::uuid,(o->>'id')::uuid)];
  uids := array[(o->>'teacher_id')::uuid,(n->>'teacher_id')::uuid];
 elsif tg_table_name in ('class_schedules','class_delegations','enrollments') then
  cids := array[(o->>'class_id')::uuid,(n->>'class_id')::uuid];
  uids := array[(o->>'teacher_id')::uuid,(n->>'teacher_id')::uuid,
    (o->>'delegate_user_id')::uuid,(n->>'delegate_user_id')::uuid];
 elsif tg_table_name='students' then
  select array_agg(distinct e.class_id) into cids from public.enrollments e
  where e.student_id=coalesce((n->>'id')::uuid,(o->>'id')::uuid);
 end if;
 -- Deterministic binding order also handles a source user/relationship move.
 for b in select * from tm_sync_private.bindings where tenant_id=any(tids) order by id for no key update loop
  update tm_sync_private.bindings set security_revision=security_revision+1,
   tenant_generation=tenant_generation+case when tenant_revoke then 1 else 0 end where id=b.id;
  if who is not null then
   insert into tm_sync_private.user_state(binding_id,user_id,account_generation,class_list_revision,deleted_at)
    values(b.id,who,1,1,case when (tg_op='DELETE' and tg_table_name='users') or (tg_table_name='users' and (n->>'tenant_id')::uuid<>b.tenant_id) then now() end)
   on conflict(binding_id,user_id) do update set account_generation=tm_sync_private.user_state.account_generation+1,
    class_list_revision=tm_sync_private.user_state.class_list_revision+1,deleted_at=excluded.deleted_at;
  end if;
  foreach cid in array coalesce(cids,'{}') loop
   continue when cid is null;
   insert into tm_sync_private.class_state(binding_id,class_id,permission_revision,deleted_at)
    values(b.id,cid,1,case when tg_table_name='classes' and tg_op='DELETE' then now() end)
   on conflict(binding_id,class_id) do update set permission_revision=tm_sync_private.class_state.permission_revision+1,
    deleted_at=excluded.deleted_at;
  end loop;
  insert into tm_sync_private.user_state(binding_id,user_id,class_list_revision)
  select b.id,q.id,1 from (
   select unnest(uids) id
   union select c.teacher_id from public.classes c where c.tenant_id=b.tenant_id and c.id=any(cids)
   union select s.teacher_id from public.class_schedules s where s.tenant_id=b.tenant_id and s.class_id=any(cids)
   union select d.delegate_user_id from public.class_delegations d where d.tenant_id=b.tenant_id and d.class_id=any(cids)
  ) q where q.id is not null
  on conflict(binding_id,user_id) do update set class_list_revision=tm_sync_private.user_state.class_list_revision+1;
  perform tm_sync_private.emit(b.id,'security',tg_table_schema||'.'||tg_table_name,
    coalesce((n->>'id')::uuid,(o->>'id')::uuid));
 end loop;
 return coalesce(new,old);
exception when others then
 raise exception using errcode='PTS01',message='변경 기록을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
end; $$;

create or replace function tm_sync_private.capture_content() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
 n jsonb := case when tg_op='DELETE' then '{}'::jsonb else to_jsonb(new) end;
 k text; same boolean:=true; bid uuid;
begin
 if tg_op='UPDATE' then
  foreach k in array string_to_array(tg_argv[0],',') loop
   if o->k is distinct from n->k then same:=false; exit; end if;
  end loop;
  if same then return new; end if;
 end if;
 for bid in select id from tm_sync_private.bindings
  where tenant_id in ((o->>'tenant_id')::uuid,(n->>'tenant_id')::uuid) order by id loop
  insert into tm_sync_private.content_dirty(binding_id) values(bid)
   on conflict(binding_id) do update set changed_at=clock_timestamp();
  perform tm_sync_private.wake(bid);
 end loop;
 return coalesce(new,old);
exception when others then
 -- A daily complete content hash repairs missed best-effort invalidations.
 -- Never log SQLERRM: it could contain report content or profile values.
 return coalesce(new,old);
end; $$;

create or replace function tm_sync_private.guard_truncate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists(select 1 from tm_sync_private.bindings) then
  raise exception using errcode='PTS01',message='연결된 데이터는 개별 항목으로 변경해 주세요.';
 end if;
 return null;
end; $$;

create or replace function public.tm_sync_create_snapshot(p_binding_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare data jsonb; ctrl jsonb; v_manifest jsonb; collections jsonb := '{}'::jsonb;
 sid uuid:=gen_random_uuid(); gen bigint; kind text; rows jsonb; chunk jsonb;
 i integer; n integer; page_no integer; txt text; h text; specs jsonb;
 ts timestamptz:=statement_timestamp();
begin
 -- This independent row serializes exports only, not source content writes.
 update tm_sync_private.export_state set content_generation=content_generation+1
  where binding_id=p_binding_id returning content_generation into gen;
 if not found then raise exception using errcode='PTS02',message='연결 설정을 확인해 주세요.'; end if;
 select tm_sync_private.export_rows(p_binding_id) into data;
 ctrl:=data->'control';
 if not coalesce((ctrl->>'enabled')::boolean,false) or not coalesce((ctrl->>'healthy')::boolean,false) then
  raise exception using errcode='PTS03',message='현재 연결 데이터를 내보낼 수 없습니다.';
 end if;
 v_manifest:=jsonb_build_object('schemaVersion',2,'snapshotId',sid,'bindingId',p_binding_id,
  'tenantId',ctrl->'tenantId','targetBranchId',ctrl->'targetBranchId','sourceEpoch',ctrl->'sourceEpoch',
  'securityRevision',ctrl->'securityRevision','contentGeneration',gen::text,
  'generatedAt',tm_sync_private.iso(ts),'expiresAt',tm_sync_private.iso(ts+interval '15 minutes'),
  'complete',true,'control',ctrl);
 insert into tm_sync_private.snapshots(id,binding_id,manifest,expires_at)
  values(sid,p_binding_id,v_manifest,ts+interval '15 minutes');
 foreach kind in array array['staff','classes','memberships','students','enrollments','progress'] loop
  rows:=data->'collections'->kind; n:=jsonb_array_length(rows); i:=0; page_no:=0; specs:='[]';
  while i<n loop
   select jsonb_agg(x.value order by x.ordinality) into chunk
    from jsonb_array_elements(rows) with ordinality x where x.ordinality>i and x.ordinality<=i+100;
   txt:=chunk::text;
   h:=tm_sync_private.hash(txt);
   -- The transport embeds this exact JSON text as a STRING inside Page, so its
   -- quotes, backslashes and control escapes are escaped a second time. Bound
   -- the complete response, not only txt. jsonb::text includes whitespace and
   -- is conservative relative to JSON.stringify used by the HTTP adapter.
   if octet_length(txt)>1500000 or octet_length(jsonb_build_object(
     'snapshotId',sid,'bindingId',p_binding_id,'kind',kind,'page',page_no,
     'json',txt,'sha256',h)::text)>2097152 then
    raise exception using errcode='PTS04',message='내보내기 페이지 크기를 확인해 주세요.';
   end if;
   insert into tm_sync_private.pages(snapshot_id,kind,page,row_count,json_text,sha256)
    values(sid,kind,page_no,jsonb_array_length(chunk),txt,h);
   specs:=specs||jsonb_build_array(jsonb_build_object('page',page_no,'count',jsonb_array_length(chunk),'sha256',h));
   i:=i+100; page_no:=page_no+1;
  end loop;
  collections:=collections||jsonb_build_object(kind,jsonb_build_object('total',n,'pages',specs));
 end loop;
 v_manifest:=v_manifest||jsonb_build_object('collections',collections);
 if octet_length(v_manifest::text)>2097152 then
  raise exception using errcode='PTS04',message='내보내기 페이지 크기를 확인해 주세요.';
 end if;
 update tm_sync_private.snapshots set manifest=v_manifest where id=sid;
 return v_manifest;
end; $$;

create or replace function public.tm_sync_snapshot_page(p_binding_id uuid,p_snapshot_id uuid,p_kind text,p_page integer)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('snapshotId',s.id,'bindingId',s.binding_id,'kind',p.kind,'page',p.page,'json',p.json_text,'sha256',p.sha256)
 from tm_sync_private.snapshots s join tm_sync_private.pages p on p.snapshot_id=s.id
 where s.binding_id=p_binding_id and s.id=p_snapshot_id and s.expires_at>statement_timestamp()
  and p.kind=p_kind and p.page=p_page;
$$;

create or replace function public.tm_sync_claim_events(p_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid event limit'; end if;
 with due as (
  select o.id from tm_sync_private.outbox o where o.status in ('pending','leased','received','retry')
   and o.available_at<=clock_timestamp() and (o.lease_until is null or o.lease_until<=clock_timestamp())
  order by case o.kind when 'security' then 0 when 'reconcile' then 1 else 2 end,o.available_at,o.id
  limit p_limit for update skip locked
 ), claimed as (
  update tm_sync_private.outbox o set status='leased',lease_token=gen_random_uuid(),
   lease_until=clock_timestamp()+interval '180 seconds',attempts=attempts+1
  from due where o.id=due.id returning o.*
 ) select coalesce(jsonb_agg(jsonb_build_object('event',c.event,'leaseToken',c.lease_token,'attempts',c.attempts)),'[]')
 into result from claimed c;
 return result;
end; $$;

create or replace function public.tm_sync_finish_event(p_event_id uuid,p_lease_token uuid,p_status text,p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
 if p_status not in ('received','applied','conflict','superseded','retry') or p_status is null then
  raise exception 'Invalid event status';
 end if;
 update tm_sync_private.outbox set status=p_status,lease_token=null,lease_until=null,
  -- Only allow a small diagnostic code, never transport bodies, email or PII.
  last_error=case when p_error is null then null when p_error ~ '^[A-Za-z0-9_:-]{1,80}$' then p_error else 'delivery_error' end,
  available_at=clock_timestamp()+case when p_status='received' then interval '15 seconds'
   else make_interval(secs=>least(300,power(2,least(attempts,8))::integer)+floor(random()*5)::integer) end,
  finished_at=case when p_status in ('applied','conflict','superseded') then clock_timestamp() else null end
 where id=p_event_id and status='leased' and lease_token=p_lease_token and lease_until>clock_timestamp()
 returning binding_id into bid;
 if not found then return false; end if;
 if p_status='applied' then update tm_sync_private.bindings set last_success_at=clock_timestamp() where id=bid; end if;
 return true;
end; $$;

create or replace function public.tm_sync_consume_nonce(p_binding_id uuid,p_nonce uuid,p_expires_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if p_nonce is null or p_expires_at is null or p_expires_at<=clock_timestamp()
  or p_expires_at>clock_timestamp()+interval '2 minutes' then return false; end if;
 insert into tm_sync_private.nonces(binding_id,nonce,expires_at) values(p_binding_id,p_nonce,p_expires_at)
  on conflict do nothing;
 return found;
end; $$;

create or replace function public.tm_sync_issue_code(p_binding_id uuid,p_user_id uuid,p_code_hash text,p_state_hash text,p_challenge text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c jsonb; u jsonb; b tm_sync_private.bindings;
begin
 select * into b from tm_sync_private.bindings where id=p_binding_id for no key update;
 if not found then return false; end if;
 c:=public.tm_sync_control(p_binding_id,p_user_id); u:=c->'users'->0;
 if b.mode<>'active' or not coalesce((u->>'eligible')::boolean,false) then return false; end if;
 insert into tm_sync_private.codes(binding_id,code_hash,user_id,state_hash,challenge,source_epoch,tenant_generation,account_generation)
 values(b.id,p_code_hash,p_user_id,p_state_hash,p_challenge,b.source_epoch,b.tenant_generation,(u->>'accountRevocationGeneration')::bigint)
 on conflict do nothing;
 return found;
end; $$;

create or replace function public.tm_sync_redeem_code(p_binding_id uuid,p_code_hash text,p_state_hash text,p_challenge text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare code tm_sync_private.codes; c jsonb; u jsonb; ts timestamptz:=clock_timestamp();
begin
 perform 1 from tm_sync_private.bindings where id=p_binding_id for no key update;
 select * into code from tm_sync_private.codes where binding_id=p_binding_id and code_hash=p_code_hash for update;
 if not found or code.consumed_at is not null or code.expires_at<=clock_timestamp()
  or code.state_hash is distinct from p_state_hash or code.challenge is distinct from p_challenge then return null; end if;
 c:=public.tm_sync_control(p_binding_id,code.user_id); u:=c->'users'->0;
 -- A valid matching proof is consumed even if eligibility was revoked.
 update tm_sync_private.codes set consumed_at=clock_timestamp() where binding_id=p_binding_id and code_hash=p_code_hash;
 if c->>'mode'<>'active' or not coalesce((u->>'eligible')::boolean,false)
  or (c->>'sourceEpoch')::uuid<>code.source_epoch
  or (c->>'tenantRevocationGeneration')::bigint<>code.tenant_generation
  or (u->>'accountRevocationGeneration')::bigint<>code.account_generation then return null; end if;
 return jsonb_build_object('control',c,'user',u,'jti',gen_random_uuid(),
  'issuedAt',tm_sync_private.iso(ts),'expiresAt',tm_sync_private.iso(ts+interval '60 seconds'));
end; $$;

-- HTTP token route uses this wrapper so replay nonce and authorization code
-- consumption share a transaction. The four-argument contract RPC remains usable
-- internally; never perform the two mutations as separate HTTP transactions.
create or replace function public.tm_sync_exchange_code(p_binding_id uuid,p_code_hash text,p_state_hash text,p_challenge text,p_nonce uuid,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not public.tm_sync_consume_nonce(p_binding_id,p_nonce,p_expires_at) then return null; end if;
 return public.tm_sync_redeem_code(p_binding_id,p_code_hash,p_state_hash,p_challenge);
end; $$;

create or replace function public.tm_sync_configure_binding(p_binding_id uuid,p_tenant_id uuid,p_target_branch_id text,p_mode text default 'shadow',p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tm_sync_private.bindings;
begin
 if p_binding_id is null or p_tenant_id is null or p_target_branch_id is null or p_mode is null or p_mode not in ('shadow','active') then raise exception 'Invalid binding configuration'; end if;
 -- Serialize the initially absent row as well: concurrent first registration
 -- must recheck identity after the winner commits, never report a false mapping.
 perform pg_advisory_xact_lock(hashtextextended('tm-sync-binding:'||p_binding_id::text,0));
 if not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception 'Unknown source tenant'; end if;
 select * into b from tm_sync_private.bindings where id=p_binding_id for no key update;
 if found and (b.tenant_id<>p_tenant_id or b.target_branch_id<>p_target_branch_id) then raise exception 'Binding identity is immutable'; end if;
 if b.id is null and p_mode<>'shadow' then raise exception 'New bindings must start in shadow'; end if;
 if exists(select 1 from tm_sync_private.bindings where id<>p_binding_id and (tenant_id=p_tenant_id or target_branch_id=p_target_branch_id)) then raise exception 'Binding mapping already exists'; end if;
 if p_apply then
  insert into tm_sync_private.bindings(id,tenant_id,target_branch_id,mode) values(p_binding_id,p_tenant_id,p_target_branch_id,'shadow') on conflict do nothing;
  insert into tm_sync_private.export_state(binding_id) values(p_binding_id) on conflict do nothing;
  insert into tm_sync_private.user_state(binding_id,user_id)
   select p_binding_id,id from public.users where tenant_id=p_tenant_id and system_role::text in ('teacher','manager','master','admin') on conflict do nothing;
  insert into tm_sync_private.class_state(binding_id,class_id)
   select p_binding_id,id from public.classes where tenant_id=p_tenant_id and subject='math' on conflict do nothing;
  if b.id is not null and b.mode<>p_mode then
   update tm_sync_private.bindings set mode=p_mode,security_revision=security_revision+1,
    tenant_generation=tenant_generation+1 where id=p_binding_id;
  end if;
  if b.id is null or b.mode<>p_mode then perform tm_sync_private.emit(p_binding_id,'security','binding',p_binding_id); end if;
 end if;
 return jsonb_build_object('bindingId',p_binding_id,'tenantId',p_tenant_id,'targetBranchId',p_target_branch_id,
  'mode',p_mode,'applied',p_apply,'existing',b.id is not null,'healthy',tm_sync_private.healthy());
end; $$;

-- A single installation opt-in; no per-tenant credential or manual target branch is required.
-- The private flag remains false until the configured application explicitly enables it.
create table if not exists tm_sync_private.automatic_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 excluded_tenants uuid[] not null default '{}'
);
insert into tm_sync_private.automatic_settings(singleton) values(true) on conflict do nothing;

create or replace function tm_sync_private.ensure_auto_binding(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from tm_sync_private.automatic_settings where enabled and not (p_tenant_id=any(excluded_tenants))) then return; end if;
 -- Same lock key as explicit configuration; recheck after a concurrent first ON.
 perform pg_advisory_xact_lock(hashtextextended('tm-sync-binding:'||p_tenant_id::text,0));
 if exists(select 1 from tm_sync_private.bindings where tenant_id=p_tenant_id) then return; end if;
 if not exists(select 1 from public.tenant_licenses l join public.tenants t on t.id=l.tenant_id
   where l.tenant_id=p_tenant_id and l.feature='todays_math' and l.is_active
   and (l.expires_at is null or l.expires_at>statement_timestamp())) then return; end if;
 perform public.tm_sync_configure_binding(p_tenant_id,p_tenant_id,p_tenant_id::text,'shadow',true);
 perform public.tm_sync_configure_binding(p_tenant_id,p_tenant_id,p_tenant_id::text,'active',true);
end; $$;

create or replace function public.tm_sync_configure_automatic(p_enabled boolean,p_excluded_tenants uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid uuid;
begin
 if p_enabled is null or p_excluded_tenants is null or array_position(p_excluded_tenants,null) is not null then raise exception 'Invalid automatic configuration'; end if;
 update tm_sync_private.automatic_settings set enabled=p_enabled,excluded_tenants=p_excluded_tenants
  where enabled is distinct from p_enabled or excluded_tenants is distinct from p_excluded_tenants;
 if p_enabled then
  for tid in select distinct l.tenant_id from public.tenant_licenses l
   where l.feature='todays_math' and l.is_active and (l.expires_at is null or l.expires_at>statement_timestamp())
   order by l.tenant_id loop
   perform tm_sync_private.ensure_auto_binding(tid);
  end loop;
 end if;
 -- Include OFF bindings so their outbox, suspension, and later reactivation keep flowing.
 return (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from tm_sync_private.bindings
  where id=tenant_id and target_branch_id=id::text and not (tenant_id=any(p_excluded_tenants)));
end; $$;

create or replace function public.tm_sync_schema_health()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('schemaVersion',2,'healthy',tm_sync_private.healthy(),
 'checks',coalesce((select jsonb_agg(jsonb_build_object('relation',e.relation_name,'trigger',e.trigger_name,
  'valid',coalesce(t.tgenabled in ('O','A') and tm_sync_private.hash(pg_get_triggerdef(t.oid))=e.definition_hash
   and tm_sync_private.hash(pg_get_functiondef(t.tgfoid))=e.function_hash,false)) order by e.relation_name,e.trigger_name)
 from tm_sync_private.trigger_contract e left join pg_trigger t on t.tgrelid=to_regclass(e.relation_name) and t.tgname=e.trigger_name),'[]'::jsonb),
 'functionChecks',coalesce((select jsonb_agg(jsonb_build_object('signature',f.signature,
  'valid',coalesce(tm_sync_private.hash(pg_get_functiondef(to_regprocedure(f.signature)))=f.definition_hash,false)) order by f.signature)
  from tm_sync_private.function_contract f),'[]'::jsonb),
 'wakeConfigured',exists(select 1 from tm_sync_private.wake_config),
 'wakeTransportInstalled',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null);
$$;

create or replace function public.tm_sync_configure_wake(p_source_origin text,p_wake_secret text,p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if p_source_origin is null or not (p_source_origin ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'
  or p_source_origin ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$') then raise exception 'Fixed HTTPS source origin required'; end if;
 if p_wake_secret is null or length(btrim(p_wake_secret))<32 or length(p_wake_secret)>1024 then raise exception 'Wake secret must contain at least 32 characters'; end if;
 if p_apply then
  insert into tm_sync_private.wake_config(singleton,source_origin,wake_secret) values(true,p_source_origin,btrim(p_wake_secret))
   on conflict(singleton) do update set source_origin=excluded.source_origin,wake_secret=excluded.wake_secret;
 end if;
 return jsonb_build_object('configured',p_apply,'sourceOrigin',p_source_origin,
  'transportInstalled',to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null);
end; $$;

create or replace function public.tm_sync_status(p_binding_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('bindingId',b.id,'tenantId',b.tenant_id,'targetBranchId',b.target_branch_id,
  'mode',b.mode,'sourceEpoch',b.source_epoch,'securityRevision',b.security_revision::text,
  'tenantRevocationGeneration',b.tenant_generation::text,'healthy',tm_sync_private.healthy() and not b.history_gap,
  'historyGap',b.history_gap,'lastSuccessAt',tm_sync_private.iso(b.last_success_at),'lastReconciledAt',tm_sync_private.iso(b.last_reconciled_at),
  'lastFullAt',tm_sync_private.iso(b.last_full_at),'outbox',coalesce((
   select jsonb_object_agg(q.status,q.n) from (select status,count(*) n from tm_sync_private.outbox where binding_id=b.id group by status) q),'{}'::jsonb),
  'oldestPendingAt',(select tm_sync_private.iso(min(o.occurred_at)) from tm_sync_private.outbox o where o.binding_id=b.id and o.status in ('pending','leased','received','retry'))
 ) order by b.id),'[]'::jsonb) from tm_sync_private.bindings b where p_binding_id is null or b.id=p_binding_id;
$$;

create or replace function public.tm_sync_retry_event(p_event_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 update tm_sync_private.outbox set status='retry',available_at=clock_timestamp(),lease_token=null,lease_until=null,finished_at=null
 where id=p_event_id and status in ('conflict','retry','received') and (lease_until is null or lease_until<=clock_timestamp());
 return found;
end; $$;

create or replace function public.tm_sync_recover_binding(p_binding_id uuid,p_expected_epoch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not tm_sync_private.healthy() then raise exception 'Repair source trigger contract before recovery'; end if;
 update tm_sync_private.bindings set history_gap=false,tenant_generation=tenant_generation+1,security_revision=security_revision+1,
  last_control_hash=null,last_audited_revision=null,last_full_at=null
 where id=p_binding_id and source_epoch=p_expected_epoch;
 if not found then raise exception 'Binding epoch changed'; end if;
 perform tm_sync_private.emit(p_binding_id,'security','history_recovery',p_binding_id);
 return public.tm_sync_control(p_binding_id);
end; $$;

create or replace function public.tm_sync_reconcile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b tm_sync_private.bindings; c jsonb; ch text; full_hash text; data jsonb;
 good boolean:=tm_sync_private.healthy(); n integer:=0; full_n integer:=0;
 boundary boolean; dirty boolean; changed boolean;
begin
 for b in select * from tm_sync_private.bindings order by id for no key update skip locked loop
  if not good and not b.history_gap then
   update tm_sync_private.bindings set history_gap=true,security_revision=security_revision+1,tenant_generation=tenant_generation+1 where id=b.id;
   perform tm_sync_private.emit(b.id,'security','schema_health',null);
  end if;
  boundary:=b.last_next_effective_at is not null and b.last_next_effective_at<=clock_timestamp();
  if boundary or b.last_reconciled_at is null or b.last_reconciled_at<=clock_timestamp()-interval '5 minutes' then
   c:=public.tm_sync_control(b.id);
   ch:=tm_sync_private.security_hash(b.id);
   changed:=b.last_control_hash is not null and ch<>b.last_control_hash;
   if changed and b.last_audited_revision=b.security_revision then
    -- Without a known date boundary, a changed authoritative security hash with
    -- no recorded revision is a recording gap. Never silently bless it.
    update tm_sync_private.bindings set security_revision=security_revision+1,
     tenant_generation=tenant_generation+case when not boundary or not (c->>'enabled')::boolean then 1 else 0 end,
     history_gap=history_gap or not boundary where id=b.id;
    update tm_sync_private.class_state set permission_revision=permission_revision+1 where binding_id=b.id;
    update tm_sync_private.user_state set class_list_revision=class_list_revision+1 where binding_id=b.id;
    perform tm_sync_private.emit(b.id,'security',case when boundary then 'effective_boundary' else 'history_gap' end,null);
   elsif boundary then
    update tm_sync_private.bindings set security_revision=security_revision+1 where id=b.id;
    update tm_sync_private.class_state set permission_revision=permission_revision+1 where binding_id=b.id;
    update tm_sync_private.user_state set class_list_revision=class_list_revision+1 where binding_id=b.id;
    perform tm_sync_private.emit(b.id,'security','effective_boundary',null);
   end if;
   c:=public.tm_sync_control(b.id);
   update tm_sync_private.bindings set last_control_hash=tm_sync_private.security_hash(b.id),
    last_audited_revision=security_revision,last_reconciled_at=clock_timestamp(),last_next_effective_at=(c->>'nextEffectiveAt')::timestamptz where id=b.id;
   -- Small reconciliation event causes authenticated current-control/version
   -- comparison at the target. An unchanged target need not fetch full pages.
   perform tm_sync_private.emit(b.id,'reconcile','control_digest',null); n:=n+1;
  end if;
  delete from tm_sync_private.content_dirty where binding_id=b.id; dirty:=found;
  if dirty then perform tm_sync_private.emit(b.id,'content','content_dirty',null); end if;
  if b.last_full_at is null or b.last_full_at<=clock_timestamp()-interval '1 day' then
   select tm_sync_private.export_rows(b.id) into data;
   full_hash:=tm_sync_private.hash((data->'collections')::text);
   if b.last_content_hash is distinct from full_hash and not dirty then
    perform tm_sync_private.emit(b.id,'content','full_digest',null);
   end if;
   update tm_sync_private.bindings set last_content_hash=full_hash,last_full_at=clock_timestamp() where id=b.id;
   full_n:=full_n+1;
  end if;
 end loop;
 delete from tm_sync_private.nonces where expires_at<clock_timestamp()-interval '5 minutes';
 delete from tm_sync_private.codes where expires_at<clock_timestamp()-interval '1 day';
 delete from tm_sync_private.snapshots where expires_at<clock_timestamp()-interval '1 day';
 delete from tm_sync_private.outbox where status in ('applied','superseded') and finished_at<clock_timestamp()-interval '30 days';
 -- No cleanup ever removes identity tombstones or security generations.
 return jsonb_build_object('healthy',good,'controlChecks',n,'fullChecks',full_n);
end; $$;

-- All security lifecycle tables are required. No conditional installation that
-- could silently skip a missing dependency and later issue eligible accounts.
do $$
declare r record; rel text; fn text; row_trigger text; trunc_trigger text;
begin
 for r in select * from (values
  ('public.tenants','id,name'),
  ('public.tenant_licenses','tenant_id,feature,is_active,expires_at'),
  ('public.users','id,tenant_id,status,system_role,subjects'),
  ('auth.users','id,banned_until,deleted_at,role'),
  ('public.super_admins','id'),
  ('public.classes','id,tenant_id,subject,teacher_id,is_active,closed_at,pending_teacher_id,pending_teacher_date'),
  ('public.class_schedules','id,tenant_id,class_id,teacher_id,valid_from,valid_to,day_of_week,start_time,end_time'),
  ('public.class_delegations','id,tenant_id,class_id,delegate_user_id,from_date,to_date,revoked_at'),
  ('public.enrollments','id,tenant_id,student_id,class_id,start_date,end_date,on_hold,is_transferred,attendance_days'),
  ('public.students','id,tenant_id,status,is_test,withdrawn_at')
 ) as x(rel,cols) loop
  row_trigger:='tm_sync_security'; trunc_trigger:='tm_sync_truncate';
  execute format('drop trigger if exists %I on %s',row_trigger,r.rel);
  execute format('create trigger %I after insert or update or delete on %s for each row execute function tm_sync_private.capture_security(%L)',row_trigger,r.rel,r.cols);
  execute format('drop trigger if exists %I on %s',trunc_trigger,r.rel);
  execute format('create trigger %I before truncate on %s for each statement execute function tm_sync_private.guard_truncate()',trunc_trigger,r.rel);
  insert into tm_sync_private.trigger_contract(relation_name,trigger_name,definition_hash,function_hash)
   select r.rel,t.tgname,tm_sync_private.hash(pg_get_triggerdef(t.oid)),tm_sync_private.hash(pg_get_functiondef(t.tgfoid))
   from pg_trigger t where t.tgrelid=to_regclass(r.rel) and t.tgname in (row_trigger,trunc_trigger)
  on conflict(relation_name,trigger_name) do update set definition_hash=excluded.definition_hash,function_hash=excluded.function_hash;
 end loop;
 for r in select * from (values
  ('public.users','id,tenant_id,email,display_name'),
  ('public.classes','id,tenant_id,class_name'),
  ('public.students','id,tenant_id,name,grade,school'),
  ('public.lesson_reports','id,tenant_id,student_id,class_id,makeup_class_id,subject,report_date,created_at,progress')
 ) as x(rel,cols) loop
  execute format('drop trigger if exists tm_sync_content on %s',r.rel);
  execute format('create trigger tm_sync_content after insert or update or delete on %s for each row execute function tm_sync_private.capture_content(%L)',r.rel,r.cols);
 end loop;
 for rel in select tablename from pg_tables where schemaname='tm_sync_private' loop
  execute format('alter table tm_sync_private.%I enable row level security',rel);
 end loop;
end; $$;

insert into tm_sync_private.function_contract(signature,definition_hash)
 select signature,tm_sync_private.hash(pg_get_functiondef(to_regprocedure(signature)))
 from unnest(array[
  'tm_sync_private.capture_security()', 'tm_sync_private.emit(uuid,text,text,uuid)',
  'tm_sync_private.memberships(uuid)', 'tm_sync_private.guard_truncate()',
  'public.tm_sync_control(uuid,uuid)', 'tm_sync_private.security_hash(uuid)',
  'tm_sync_private.export_rows(uuid)', 'tm_sync_private.next_effective(uuid,timestamp with time zone)',
  'public.class_period_closed_end(uuid)'
  ,'tm_sync_private.ensure_auto_binding(uuid)', 'public.tm_sync_configure_automatic(boolean,uuid[])'
 ]) signature
 on conflict(signature) do update set definition_hash=excluded.definition_hash;

revoke all on all tables in schema tm_sync_private from public,anon,authenticated,service_role;
revoke all on all functions in schema tm_sync_private from public,anon,authenticated,service_role;
do $$
declare f record;
begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'tm_sync_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end; $$;
notify pgrst,'reload schema';
commit;
