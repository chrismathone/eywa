-- 0069a: makeedu 즉시 동기화 요청 큐 — 프로덕션(Vercel) '지금 동기화' 버튼 → 동기화 PC 릴레이.
-- Vercel(서버리스)은 sync-all.cjs를 실행할 수 없고 makeedu는 신뢰(집) IP만 허용하므로, 버튼은 여기에
-- 요청 행만 남기고(서버 액션, service_role) 동기화 PC의 상주 워처(scripts/_makeedu/watch-sync-requests.cjs,
-- 작업 스케줄러 "eywa-makeedu-sync-watcher")가 15초 폴링으로 감지해 sync-all.cjs --apply를 대신 실행한다.
-- PC가 꺼져 있으면 pending으로 남았다가 켜질 때 따라잡는다(additive·멱등이라 안전).
create table if not exists makeedu_sync_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid references users(id) on delete set null,  -- 누가 눌렀나(감사용)
  requested_at timestamptz not null default now(),
  status text not null default 'pending',                     -- pending|running|done|error
  started_at timestamptz,
  finished_at timestamptz,
  error text
);

create index if not exists ix_makeedu_sync_requests_status
  on makeedu_sync_requests (status, requested_at);

alter table makeedu_sync_requests enable row level security;

-- 테넌트 멤버는 자기 테넌트 요청 read(상태 확인용). write는 service_role(서버 액션 admin client)과
-- 직접 DB 연결(워처, DATABASE_URL)만 — 정책 없음 → RLS bypass만 통과 (0058a makeedu_sync_state 패턴).
drop policy if exists makeedu_sync_requests_tenant_read on makeedu_sync_requests;
create policy makeedu_sync_requests_tenant_read on makeedu_sync_requests
  for select using (tenant_id = auth_tenant_id());
