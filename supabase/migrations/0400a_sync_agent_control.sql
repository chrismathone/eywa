-- Device registration and control are server-only. Existing workers stay valid until explicit cutover.
create table public.sync_agent_devices (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null check (length(token_hash) = 64),
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_requested_at timestamptz,
  last_seen_at timestamptz,
  version text,
  instance_id uuid,
  generation bigint not null default 0,
  lease_until timestamptz,
  status jsonb not null default '{}'::jsonb,
  unique (tenant_id, id)
);
create unique index sync_agent_one_device on public.sync_agent_devices(tenant_id) where revoked_at is null;

create table public.sync_agent_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default true,
  classnote_enabled boolean not null default true,
  makeedu_enabled boolean not null default true,
  updates_enabled boolean not null default true,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  -- Switch only after legacy tasks have been stopped. Gateway access requires it.
  cutover_at timestamptz
);

create table public.sync_agent_codes (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  code_hash text not null unique check (length(code_hash) = 64),
  issued_by uuid not null references public.users(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_by uuid references public.sync_agent_devices(id),
  consumed_at timestamptz
);

create table public.sync_agent_events (
  device_id uuid not null references public.sync_agent_devices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null,
  received_at timestamptz not null default now(),
  occurred_at timestamptz not null,
  kind text not null,
  module text not null check (module in ('app','classnote','makeedu','video','update')),
  level text not null check (level in ('info','warning','error')),
  detail jsonb not null default '{}'::jsonb,
  primary key (device_id,event_id),
  foreign key (tenant_id,device_id) references public.sync_agent_devices(tenant_id,id)
);
create index sync_agent_events_tenant_time on public.sync_agent_events(tenant_id,received_at desc);

create table public.sync_agent_attempts (
  key_hash text primary key,
  bucket timestamptz not null,
  attempts integer not null check (attempts > 0)
);

create table public.sync_agent_releases (
  version text primary key,
  sequence bigint not null unique check (sequence > 0),
  manifest jsonb not null,
  signature text not null,
  installer_url text not null,
  published_at timestamptz not null default now(),
  revoked_at timestamptz
);

do $$ declare n text; begin
  foreach n in array array['sync_agent_devices','sync_agent_settings','sync_agent_codes','sync_agent_events','sync_agent_attempts','sync_agent_releases'] loop
    execute format('alter table public.%I enable row level security',n);
    execute format('revoke all on public.%I from public, anon, authenticated',n);
  end loop;
end $$;

-- Claim and renew take the same device row lock used by revoke/cutover/settings gates.
-- Public routes never receive EXECUTE privileges; the application server owns control.
create function public.claim_sync_agent(p_device uuid,p_instance uuid,p_version text)
returns table(generation bigint,remaining_ms bigint)
language sql security definer set search_path=pg_catalog as $$
  update public.sync_agent_devices d set instance_id=p_instance,
    generation=case when d.instance_id=p_instance and d.lease_until>clock_timestamp() then d.generation else d.generation+1 end,
    lease_until=clock_timestamp()+interval '90 seconds',last_seen_at=clock_timestamp(),version=p_version
  where d.id=p_device and d.revoked_at is null and d.revoke_requested_at is null
    and (d.lease_until is null or d.lease_until<=clock_timestamp() or d.instance_id=p_instance)
  returning d.generation,floor(extract(epoch from(d.lease_until-clock_timestamp()))*1000)::bigint;
$$;
revoke all on function public.claim_sync_agent(uuid,uuid,text) from public,anon,authenticated;
