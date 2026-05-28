-- RLS for scenarios
alter table public.scenarios enable row level security;

drop policy if exists scenarios_tenant_isolation on public.scenarios;
create policy scenarios_tenant_isolation on public.scenarios
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
