-- 0033a — 테넌트 단위 학원 설정(owner 콘솔). 손수 alpha 파일(0032a 다음). 전부 멱등.
-- 학원장(master)이 학원에 관한 모든 커스텀값(과목·교시·직급·청구 기본값·약관 등)을 한 곳에서
-- 설정하고 해당 테넌트 전체에 적용. 단일 행/테넌트 + jsonb 문서(앱단 Zod + DEFAULT_SETTINGS merge).
-- ⚠️ drizzle migrate 대신 raw 적용. 의존: 0001a public.auth_tenant_id().

begin;

create table if not exists public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  data jsonb not null default '{}'::jsonb, -- 설정 문서. 빈 키는 DEFAULT_SETTINGS로 폴백.
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- RLS — 테넌트 격리(0001a 템플릿). 읽기는 같은 테넌트 전원, 쓰기 권한(master)은 라우트/액션에서 게이트.
alter table public.tenant_settings enable row level security;
drop policy if exists tenant_settings_isolation on public.tenant_settings;
create policy tenant_settings_isolation on public.tenant_settings
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

commit;
