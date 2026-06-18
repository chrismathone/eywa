-- 0031a — 운영 감사로그(테넌트 스코프). 손수 alpha 파일(0030a 다음). 전부 멱등.
-- super_admin_audit_logs의 academy(테넌트) 버전 — 역할변경·삭제·청구·시험·급여 등 고가치 mutation 추적.
-- ⚠️ drizzle migrate 대신 raw 적용. 의존: 0001a public.auth_tenant_id().

begin;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  actor_name text,
  action text not null, -- staff_role_change / staff_delete / invoice_create / exam_create / ...
  target_type text, -- staff / student / invoice / exam / payroll ...
  target_label text, -- 사람이 읽는 대상(이름 등)
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at);
create index if not exists audit_logs_tenant_action_idx on public.audit_logs (tenant_id, action);

-- RLS — 테넌트 격리(0001a 템플릿). 뷰어 접근은 라우트(master)에서 추가 게이트.
alter table public.audit_logs enable row level security;
drop policy if exists audit_logs_tenant_isolation on public.audit_logs;
create policy audit_logs_tenant_isolation on public.audit_logs
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

commit;
