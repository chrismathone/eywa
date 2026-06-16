-- reenrollment_campaign_targets: RLS(tenant_isolation) + updated_at 트리거.
-- 0024 drizzle 마이그레이션(테이블 생성) 이후 적용. 0001a 패턴(auth_tenant_id, tg_set_updated_at) 재사용.
-- 손수 alpha 파일(drizzle 무관). node --env-file=.env.local 로 적용.

alter table public.reenrollment_campaign_targets enable row level security;

drop policy if exists rct_tenant_isolation on public.reenrollment_campaign_targets;
create policy rct_tenant_isolation on public.reenrollment_campaign_targets
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists reenrollment_campaign_targets_set_updated_at on public.reenrollment_campaign_targets;
create trigger reenrollment_campaign_targets_set_updated_at
  before update on public.reenrollment_campaign_targets
  for each row execute function public.tg_set_updated_at();
