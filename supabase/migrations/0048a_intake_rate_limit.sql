-- 0048a_intake_rate_limit.sql (손수 alpha)
-- 학부모 공개접수(submitPublicIntake) 다층 레이트리밋의 단일 소스 = 시도 로그.
-- 거부건도 기록 → 시도(요청) 기반 제한 + 자원 소모형 abuse 카운트. per-IP/per-tenant/per-token 윈도우.
-- 원본 IP는 저장하지 않고 sha256(ip + ':' + tenant_id) 해시만 보존(PII 회피).
create table if not exists intake_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  intake_token_id uuid references intake_tokens(id) on delete cascade,
  ip_hash text not null,
  ok boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists intake_attempts_ip_idx on intake_attempts (ip_hash, created_at);
create index if not exists intake_attempts_tenant_idx on intake_attempts (tenant_id, created_at);
create index if not exists intake_attempts_token_idx on intake_attempts (intake_token_id, created_at);

-- RLS — 직원은 자기 테넌트 시도만 조회(남용 모니터링). 공개 쓰기는 admin client(service_role)가 우회.
alter table intake_attempts enable row level security;
drop policy if exists intake_attempts_tenant_isolation on intake_attempts;
create policy intake_attempts_tenant_isolation on intake_attempts
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());
