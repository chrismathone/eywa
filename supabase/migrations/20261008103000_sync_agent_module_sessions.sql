-- Module switches prevent new sessions. Existing work receives a bounded drain window,
-- so an external post can still commit its completion record after a switch is turned off.
create table public.sync_agent_module_sessions (
  device_id uuid not null references public.sync_agent_devices(id) on delete cascade,
  module text not null check(module in ('classnote','makeedu')),
  instance_id uuid not null,
  generation bigint not null,
  started_at timestamptz not null default now(),
  stop_after timestamptz,
  primary key(device_id,module)
);
alter table public.sync_agent_module_sessions enable row level security;
revoke all on public.sync_agent_module_sessions from public,anon,authenticated;
