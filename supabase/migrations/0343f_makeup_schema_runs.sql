-- 0343f — 보강 원장 5/5: 대사 실행 기록(makeup_reconciliation_runs)
--
-- 대사(출결·시수·수량·인계를 원장과 다시 맞춰 보는 일)를 **언제 돌렸고 어떻게 끝났는지** 남긴다. 화면은 마지막 실행을
-- 그대로 보여 준다 — 한 번도 안 돌았거나 실패했는데 "확인 필요 0건"으로만 보이면 그 0은 믿을 수 없다.
--   status: running → succeeded | failed(error에 사유)   trigger: manual(사람이 실행) | scheduled(주기 실행)
--   checked = 다시 본 대상 수 · opened = 이번에 새로 열린 확인 항목 · resolved = 이번에 사실이 맞아 닫힌 항목
-- 🔴 RLS 켜고 정책 없음 + 권한 회수 — 쓰는 길은 대사 실행 함수(0349e)뿐이다. service_role은 읽기만.
-- 멱등: create … if not exists.

create table if not exists public.makeup_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'running'
    constraint makeup_reconciliation_runs_status_chk check (status in ('running', 'succeeded', 'failed')),
  trigger text not null constraint makeup_reconciliation_runs_trigger_chk check (trigger in ('manual', 'scheduled')),
  -- 사람이 실행했으면 그 사람, 주기 실행이면 null.
  started_by uuid references public.users(id) on delete set null,
  -- 실제 시계(같은 트랜잭션 안의 실행도 순서가 선다).
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  checked integer not null default 0,
  opened integer not null default 0,
  resolved integer not null default 0,
  error text constraint makeup_reconciliation_runs_error_len check (error is null or char_length(error) <= 1000),
  detail jsonb not null default '{}'::jsonb,
  constraint makeup_reconciliation_runs_finished_chk check ((status = 'running') = (finished_at is null))
);
create index if not exists makeup_reconciliation_runs_recent_idx
  on public.makeup_reconciliation_runs (tenant_id, started_at desc);

alter table public.makeup_reconciliation_runs enable row level security;
revoke all on public.makeup_reconciliation_runs from public, anon, authenticated, service_role;
grant select on public.makeup_reconciliation_runs to service_role;
