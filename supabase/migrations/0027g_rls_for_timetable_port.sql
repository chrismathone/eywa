-- RLS + 부분 인덱스 for 시간표 이식 (Phase 1)
-- 손수 alpha 파일(drizzle 무관). 신규 3테이블 tenant_isolation + class_schedules.merge_group 부분 인덱스.
-- 적용: node --env-file=.env.local 로 raw 실행 (CLAUDE.md "마이그레이션 & 시드").

-- 1) RLS — 신규 tenant-scoped 테이블 (다른 테이블과 동일한 tenant_isolation 정책)
alter table public.english_levels enable row level security;
alter table public.timetable_snapshots enable row level security;
alter table public.timetable_import_logs enable row level security;

drop policy if exists english_levels_tenant_isolation on public.english_levels;
create policy english_levels_tenant_isolation on public.english_levels
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists timetable_snapshots_tenant_isolation on public.timetable_snapshots;
create policy timetable_snapshots_tenant_isolation on public.timetable_snapshots
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop policy if exists timetable_import_logs_tenant_isolation on public.timetable_import_logs;
create policy timetable_import_logs_tenant_isolation on public.timetable_import_logs
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- 2) 합반(merged) 부분 인덱스 — 같은 셀에 묶인 schedules 조회 (Drizzle WHERE 미표현 → 손수)
create index if not exists schedules_tenant_merge_idx
  on public.class_schedules (tenant_id, merge_group)
  where merge_group is not null;
