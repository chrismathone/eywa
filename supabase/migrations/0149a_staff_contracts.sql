-- 0149a_staff_contracts.sql (손수 alpha)
-- 직원 계약 이력(원장 지시 2026-07-29) — 직원 상세 '계약현황'의 현재계약 + 계약조건 히스토리.
--
-- 기본 규칙: **첫 출근일로부터 1년**이 1차 계약이고, 차수가 늘 때마다 1년씩 이어진다.
-- 그 파생값은 코드가 계산하므로(계약 행이 하나도 없어도 현재계약이 보인다) 이 테이블은
-- **실제로 기입·연장된 계약만** 담는다. 행이 있으면 행이 우선(수기 기간이 파생값을 이긴다).
--
-- seq = 계약 차수(1차·2차…). (tenant_id, user_id, seq) 유일 — 같은 차수가 두 번 생기지 않게.

create table if not exists public.staff_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  seq integer not null check (seq >= 1),
  start_date date not null,
  end_date date not null,
  -- 계약조건(시트 '계약조건' 열에 대응하는 자유 텍스트 — 급여제/시간제 등 문구 그대로).
  terms text,
  memo text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_contracts_period_check check (end_date > start_date)
);

create unique index if not exists staff_contracts_user_seq_idx
  on public.staff_contracts (tenant_id, user_id, seq);
create index if not exists staff_contracts_user_idx
  on public.staff_contracts (user_id, start_date desc);

alter table public.staff_contracts enable row level security;

-- 테넌트 격리(0001a auth_tenant_id 패턴) — 읽기는 같은 학원 직원이면 가능(본인 계약현황 열람 포함),
-- 쓰기는 사무실 역할만. 급여액이 아니라 '기간·조건'이라 이력서(restricted)보다 완화된 등급.
drop policy if exists staff_contracts_tenant_read on public.staff_contracts;
create policy staff_contracts_tenant_read on public.staff_contracts
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists staff_contracts_office_write on public.staff_contracts;
create policy staff_contracts_office_write on public.staff_contracts
  for all
  using (
    tenant_id = public.auth_tenant_id()
    and public.auth_system_role() in ('master', 'admin', 'manager')
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and public.auth_system_role() in ('master', 'admin', 'manager')
  );
