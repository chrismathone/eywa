-- 0073a: makeedu 동기화 워처 심장박동 — 어느 PC가 동기화 담당인지 + 살아있는지 웹에서 표시.
-- 상주 워처(watch-sync-requests.cjs)가 매 폴(15초)마다 자기 hostname·last_seen을 upsert한다.
-- 연동 면이 이 행을 읽어 "동기화 PC: DESKTOP-ABC · 온라인/오프라인(마지막 활동 N분 전)"을 표시 →
-- 원장이 담당 PC가 켜져 있는지(요청이 처리될지) 한눈에 확인. PC별 1행.
create table if not exists makeedu_sync_workers (
  tenant_id uuid not null references tenants(id) on delete cascade,
  hostname text not null,
  started_at timestamptz,          -- 현재 워처 프로세스 시작 시각(재시작 감지)
  last_seen timestamptz not null default now(),
  primary key (tenant_id, hostname)
);

alter table makeedu_sync_workers enable row level security;

-- 테넌트 멤버는 자기 테넌트 워처 read. write는 직접 연결(워처, DATABASE_URL)·service_role만 (0058a 패턴).
drop policy if exists makeedu_sync_workers_tenant_read on makeedu_sync_workers;
create policy makeedu_sync_workers_tenant_read on makeedu_sync_workers
  for select using (tenant_id = auth_tenant_id());
