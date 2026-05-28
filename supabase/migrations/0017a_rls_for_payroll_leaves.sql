-- RLS for payroll_records + staff_leaves
alter table public.payroll_records enable row level security;
alter table public.staff_leaves enable row level security;

drop policy if exists payroll_tenant_isolation on public.payroll_records;
create policy payroll_tenant_isolation on public.payroll_records
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists staff_leaves_tenant_isolation on public.staff_leaves;
create policy staff_leaves_tenant_isolation on public.staff_leaves
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- updated_at auto-bump
drop trigger if exists payroll_records_set_updated_at on public.payroll_records;
create trigger payroll_records_set_updated_at
  before update on public.payroll_records
  for each row execute function public.tg_set_updated_at();
