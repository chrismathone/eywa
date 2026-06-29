-- 0058a: makeedu 동기화 상태 — 도메인별 마지막 동기화 시각/건수/상태.
-- 도메인(학생·수업·수강·수납·상담·예비·교재)마다 동기화 주기가 달라, 각 화면에 "마지막 동기화: N분 전"을
-- 표시하려면 도메인 단위 타임스탬프가 필요하다. 임포터/크롤러(service_role)가 성공 시 upsert, 앱은 read.
create table if not exists makeedu_sync_state (
  tenant_id uuid not null references tenants(id) on delete cascade,
  domain text not null,                       -- students|classes|enrollments|invoices|consultations|prospects|catalog
  synced_at timestamptz not null default now(),
  row_count integer,
  status text not null default 'ok',          -- ok|error
  error text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, domain)
);

alter table makeedu_sync_state enable row level security;

-- 테넌트 멤버는 자기 테넌트 행 read. write는 service_role(임포터/크롤러)만(정책 없음 → RLS bypass만 통과).
drop policy if exists makeedu_sync_state_tenant_read on makeedu_sync_state;
create policy makeedu_sync_state_tenant_read on makeedu_sync_state
  for select using (tenant_id = auth_tenant_id());
