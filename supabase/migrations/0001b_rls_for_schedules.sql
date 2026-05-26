-- RLS for class_schedules (mirrors the policies in 0001a)
alter table public.class_schedules enable row level security;

drop policy if exists class_schedules_tenant_isolation on public.class_schedules;
create policy class_schedules_tenant_isolation on public.class_schedules
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
