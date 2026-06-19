-- 0037a — 수강료 견적(tuition_quotes). 손수 alpha 파일. 전부 멱등.
-- 수강료 계산기의 "청구서로 저장"은 재원생 invoices가 아니라 신입생 상담 견적(ijw tuition_invoices 이식).
-- 학생정보 자유입력 + 과목/기타/할인 jsonb 스냅샷. invoices와 완전 분리.
-- ⚠️ drizzle migrate 대신 raw 적용. IF NOT EXISTS / drop+create.
-- 의존: 0001a public.auth_tenant_id(), public.tg_set_updated_at().

begin;

create table if not exists public.tuition_quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_name text not null,
  school text,
  grade text,
  consultant text,
  start_date date,
  end_date date,
  courses jsonb,
  extras jsonb,
  discounts jsonb,
  total_amount numeric(12, 0) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tuition_quotes_tenant_created_idx on public.tuition_quotes (tenant_id, created_at);
create index if not exists tuition_quotes_tenant_name_idx on public.tuition_quotes (tenant_id, student_name);

-- RLS — 테넌트 격리(0034a 템플릿)
alter table public.tuition_quotes enable row level security;
drop policy if exists tuition_quotes_tenant_isolation on public.tuition_quotes;
create policy tuition_quotes_tenant_isolation on public.tuition_quotes
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists tuition_quotes_set_updated_at on public.tuition_quotes;
create trigger tuition_quotes_set_updated_at
  before update on public.tuition_quotes
  for each row execute function public.tg_set_updated_at();

commit;
