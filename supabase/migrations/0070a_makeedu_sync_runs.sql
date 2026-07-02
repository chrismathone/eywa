-- 0070a: makeedu 동기화 실행 로그 — 매 실행(스케줄/버튼/원격요청/수동)마다 1행.
-- makeedu_sync_state(0058a)는 도메인별 "마지막 상태" upsert라 이력이 안 남는다 → 실행 단위 append 로그 신설.
-- sync-all.cjs가 시작 시 running으로 insert, 종료 시 ok|partial|error(+도메인 스냅샷·소요시간)로 update.
-- 토글 OFF로 건너뛴 실행도 skipped로 남겨 "cron이 돌긴 했나"까지 추적 가능.
create table if not exists makeedu_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  trigger_source text not null default 'manual', -- scheduled(작업 스케줄러)|button(로컬 버튼)|relay(프로덕션 요청 워처)|manual(CLI)
  status text not null default 'running',       -- running|ok|partial(일부 도메인 실패)|error(전체 실패)|skipped(토글 OFF)
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  domains jsonb,                                 -- {students:{status,rows}, ...} 이번 실행이 갱신한 도메인 스냅샷
  failed_domains text[],
  error text
);

create index if not exists ix_makeedu_sync_runs_recent
  on makeedu_sync_runs (tenant_id, started_at desc);

alter table makeedu_sync_runs enable row level security;

-- 테넌트 멤버는 자기 테넌트 로그 read(연동 면 실행 이력 표시). write는 직접 DB 연결(sync-all)·service_role만
-- (정책 없음 → RLS bypass만 통과, 0058a 패턴).
drop policy if exists makeedu_sync_runs_tenant_read on makeedu_sync_runs;
create policy makeedu_sync_runs_tenant_read on makeedu_sync_runs
  for select using (tenant_id = auth_tenant_id());
