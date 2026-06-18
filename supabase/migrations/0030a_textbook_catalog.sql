-- 0030a — 교재 카탈로그(마스터 단가표). 손수 alpha 파일(0029a 다음). 전부 멱등.
-- 학원 표준 교재·단가를 한 번 등록해두고 교재 신청 시 자동 채움(textbook-dialog 교재검색 picker).
-- ⚠️ drizzle migrate 대신 raw 적용(_journal 충돌 회피). IF NOT EXISTS / drop+create.
-- 의존: 0001a public.auth_tenant_id(), public.tg_set_updated_at().

begin;

create table if not exists public.textbook_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  book_detail text, -- 단원/상세 (예: "3. 함수")
  grade_level text, -- 초/중/고 (자유 텍스트)
  subject text, -- math/english/... (classes.subject와 동일 코드 컨벤션)
  publisher text,
  price numeric(12, 0) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists textbook_catalog_tenant_active_idx on public.textbook_catalog (tenant_id, is_active);
create index if not exists textbook_catalog_tenant_title_idx on public.textbook_catalog (tenant_id, title);

-- RLS — 테넌트 격리(0001a/0027a 템플릿)
alter table public.textbook_catalog enable row level security;
drop policy if exists textbook_catalog_tenant_isolation on public.textbook_catalog;
create policy textbook_catalog_tenant_isolation on public.textbook_catalog
  for all to authenticated
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

drop trigger if exists textbook_catalog_set_updated_at on public.textbook_catalog;
create trigger textbook_catalog_set_updated_at
  before update on public.textbook_catalog
  for each row execute function public.tg_set_updated_at();

commit;
