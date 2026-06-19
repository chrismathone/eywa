-- 0034a — 수강료 단가표(tuition_catalog). 손수 alpha 파일(0033a 다음). 전부 멱등.
-- ijw 수강료 계산기 "설정"의 수강료 단가표/기타항목/할인 프리셋을 한 테이블로 통합(category로 구분).
-- 수강료 계산기 면 '수강료 단가' 서브탭에서 CRUD, 계산기 탭이 picker로 소비(회당단가·할인 자동입력).
-- ⚠️ drizzle migrate 대신 raw 적용(_journal 충돌 회피). IF NOT EXISTS / drop+create.
-- 의존: 0001a public.auth_tenant_id(), public.tg_set_updated_at().

begin;

create table if not exists public.tuition_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null default '기타', -- 분류 라벨(수학/EIE/영어/국어/기타/할인)
  name text not null,
  price numeric(12, 0) not null default 0, -- 회당/월 단가 또는 할인액
  note text, -- 비고(예: "(3T2H)" 시수 표기)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tuition_catalog_tenant_active_idx on public.tuition_catalog (tenant_id, is_active);
create index if not exists tuition_catalog_tenant_category_idx on public.tuition_catalog (tenant_id, category);

-- RLS — 테넌트 격리(0001a/0030a 템플릿)
alter table public.tuition_catalog enable row level security;
drop policy if exists tuition_catalog_tenant_isolation on public.tuition_catalog;
create policy tuition_catalog_tenant_isolation on public.tuition_catalog
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists tuition_catalog_set_updated_at on public.tuition_catalog;
create trigger tuition_catalog_set_updated_at
  before update on public.tuition_catalog
  for each row execute function public.tg_set_updated_at();

commit;
