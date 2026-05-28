-- RLS for user_integrations
alter table public.user_integrations enable row level security;

drop policy if exists user_integrations_tenant_isolation on public.user_integrations;
create policy user_integrations_tenant_isolation on public.user_integrations
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- updated_at auto-bump
drop trigger if exists user_integrations_set_updated_at on public.user_integrations;
create trigger user_integrations_set_updated_at
  before update on public.user_integrations
  for each row execute function public.tg_set_updated_at();
