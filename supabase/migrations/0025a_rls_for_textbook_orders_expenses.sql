-- RLS for textbook_orders + expenses (수납관리 창의 교재신청·지출 면)
-- 손수 alpha 파일(drizzle 무관). 다른 tenant-scoped 테이블과 동일한 tenant_isolation 정책.
-- 적용: node --env-file=.env.local 로 raw 실행 (CLAUDE.md "마이그레이션 & 시드").

alter table public.textbook_orders enable row level security;
alter table public.expenses enable row level security;

drop policy if exists textbook_orders_tenant_isolation on public.textbook_orders;
create policy textbook_orders_tenant_isolation on public.textbook_orders
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists expenses_tenant_isolation on public.expenses;
create policy expenses_tenant_isolation on public.expenses
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
