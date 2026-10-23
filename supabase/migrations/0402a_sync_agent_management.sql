create table public.sync_agent_management_codes (
  device_id uuid primary key references public.sync_agent_devices(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  issued_by uuid not null references public.users(id),
  consumed_at timestamptz
);
create table public.sync_agent_schedule_runs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check(kind in ('sync','login')),
  bucket timestamptz not null,
  device_id uuid not null references public.sync_agent_devices(id),
  instance_id uuid not null,
  generation bigint not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  succeeded boolean,
  primary key(tenant_id,kind,bucket)
);
alter table public.sync_agent_management_codes enable row level security;
alter table public.sync_agent_schedule_runs enable row level security;
revoke all on public.sync_agent_management_codes, public.sync_agent_schedule_runs from public,anon,authenticated;
