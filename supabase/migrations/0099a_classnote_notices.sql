-- 0099a: 반 공지 발송 큐(classnote_notices) — eywa 반에서 학생을 골라 각 학생의 ClassNote 개별 보드로
-- 같은 내용을 일괄 게시(Edutrix NoticeWriteModal 패턴 계승). 게시는 연동 PC 워커가 내부 API
-- (POST /api/v1_2/reports/)로 처리 — Cloud Run·Puppeteer 마법사 불필요(2026-07-13 학원이 실검증).
-- targets는 큐 적재 시점에 서버 액션이 확정(게이트 통과분만): [{studentId, studentName, board}].

create table if not exists classnote_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  body text not null,
  targets jsonb not null default '[]'::jsonb,      -- [{studentId, studentName, board}]
  status text not null default 'queued',           -- queued | processing | success | partial | failed
  results jsonb,                                   -- 타깃별 결과 [{board, ok, note?}] (워커 기록)
  error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  processing_at timestamptz,                       -- 워커 클레임 시각(멈춤 복구 기준)
  processed_at timestamptz
);

create index if not exists idx_classnote_notices_queue
  on classnote_notices (tenant_id, status, created_at desc);

alter table classnote_notices enable row level security;
drop policy if exists classnote_notices_tenant_isolation on classnote_notices;
create policy classnote_notices_tenant_isolation on classnote_notices
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
