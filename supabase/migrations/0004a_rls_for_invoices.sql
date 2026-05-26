alter table public.invoices enable row level security;

drop policy if exists invoices_tenant_isolation on public.invoices;
create policy invoices_tenant_isolation on public.invoices
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.tg_set_updated_at();
