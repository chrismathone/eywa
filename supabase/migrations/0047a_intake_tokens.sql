-- 0047a: 학부모 QR 공개접수 — intake_tokens(테넌트별 공개 접수 토큰) + enrollment_consultations 출처 표시
-- 의존: 0001a public.auth_tenant_id(). 멱등.

create table if not exists public.intake_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  name text not null,
  is_active boolean not null default true,
  expires_at timestamptz,
  usage_count integer not null default 0,
  submission_count integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists intake_tokens_tenant_idx on public.intake_tokens (tenant_id);

alter table public.intake_tokens enable row level security;
drop policy if exists intake_tokens_tenant_isolation on public.intake_tokens;
create policy intake_tokens_tenant_isolation on public.intake_tokens
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- 공개접수 출처 표시(직원이 QR 접수건을 구분 + 토큰별 레이트리밋 카운트).
alter table public.enrollment_consultations
  add column if not exists from_public_intake boolean not null default false,
  add column if not exists intake_token_id uuid references public.intake_tokens(id) on delete set null;
