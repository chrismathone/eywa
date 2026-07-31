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
  -- ⚠️ **사무실만**(0167a). 예전엔 역할을 안 봐서 강사·뷰어가 PostgREST 직결로 전 직원 계약 조건
  --    132행을 읽을 수 있었다(gotchas #77). 바로 위 "급여액이 아니라 기간·조건"이라는 전제는
  --    **실데이터가 반증한다** — 132행 중 54행이 급여성 문구(급여·월급·시급·연봉·수당·만원)를 담고 있다.
  --    앱은 이미 `requireAccess("staff")`라 화면만 닫혀 있었다. 게이트는 `(select …)`로 감쌀 것(#91).
  --    본인 계약 보기를 만들면 그때 `or user_id = (select auth.uid())`를 더한다(지금은 소비처가 없다 —
  --    /me는 계약을 읽지 않는다).
  for select using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_staff_can_read())
  );

drop policy if exists staff_contracts_office_write on public.staff_contracts;
create policy staff_contracts_office_write on public.staff_contracts
  for all
  using (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  )
  with check (
    tenant_id = public.auth_tenant_id()
    and (select public.auth_system_role()) in ('master', 'admin', 'manager')
  );
