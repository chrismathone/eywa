-- 0161a_document_categories_and_links.sql (손수 alpha)
-- 데이터베이스(서식 저장소) 두 가지 확장:
--   ① 분류를 **학원장이 관리** — 코드 고정 enum(academy_document_category, 0067a) → 테넌트 소유 테이블.
--   ② **링크 문서**(kind='link') — 이미 구글드라이브·노션 등에 있는 문서를 재업로드 없이 목록에 올린다.
--
-- ① 배경: 분류가 Postgres enum이라 "기출시험" 같은 학원 고유 분류를 추가하려면 매번 ALTER TYPE 마이그레이션이
--    필요했다(삭제·이름변경은 아예 불가). 과목 키와 같은 원칙으로 **테넌트 데이터**로 내린다.
--    · 기존 6개는 `is_system=true`로 시드 — **키가 그대로**라 academy_documents.category 기존 값은 무손실.
--    · 시스템 분류는 이름·순서 변경은 되지만 **삭제 불가**: 코드가 직접 쓰는 고정 대상이 있다
--      (이력서→'hr' resume-actions.ts, 환불요청서→'billing' refund-actions.ts). 지우면 그 쓰기가 고아 키가 된다.
--    · 사용자 분류 키는 앱이 `cat_N`으로 자동 확정(과목 `subject_N` 선례) — 학원장은 이름만 입력한다.
--      키를 편집 가능하게 만들면 이름 바꿀 때마다 기존 문서 연결이 끊긴다(과목 키 orphan footgun과 동일).
--    · 삭제는 **"다른 분류로 이동 후 삭제"**(absorbSubject 선례) — 고아 키를 남기지 않는다.
--
-- ⚠️ enum 타입 `academy_document_category`는 **드롭하지 않는다** — 컬럼만 text로 완화. 드롭은 비가역이라
--    롤백(text → enum 되돌리기) 경로를 없애 버린다. 미사용 타입이 남는 비용은 0.
--
-- ② 링크: 파일 사본을 만들지 않는다. 원본은 구글드라이브가 소유하고 여기선 목록·검색·열기만
--    (linked.ts 연동 폴더와 같은 "원본 단일 소스" 원칙). 링크 유효성·권한은 대상 서비스가 판단한다.
--
-- 멱등: create ... if not exists / on conflict do nothing / do $$ 가드 / drop policy if exists → create.
-- 롤백: document_categories drop + category 컬럼을 enum으로 되돌림(값이 시스템 6키 밖이면 먼저 정리 필요).

-- ── ① academy_documents.category: enum → text ────────────────────────────────
-- default가 enum 타입이라 먼저 떼고 → 타입 변경 → 다시 붙인다. 이미 text면 통째로 skip(멱등).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'academy_documents'
      and column_name = 'category'
      and udt_name = 'academy_document_category'
  ) then
    alter table academy_documents alter column category drop default;
    alter table academy_documents alter column category type text using category::text;
    alter table academy_documents alter column category set default 'other';
    alter table academy_documents alter column category set not null;
  end if;
end $$;

-- ── 분류 테이블 ──────────────────────────────────────────────────────────────
create table if not exists document_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,                                   -- academy_documents.category가 참조하는 불변 식별자
  label text not null,                                 -- 화면 표시 이름(학원장이 편집)
  sort_order integer not null default 0,               -- 폴더 팬 표시 순서(작을수록 위)
  is_system boolean not null default false,            -- 0067a 기본 6개 — 삭제 불가(코드가 쓰는 고정 대상)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists document_categories_tenant_key_uq
  on document_categories (tenant_id, key);
create index if not exists document_categories_tenant_sort_idx
  on document_categories (tenant_id, sort_order, key);

alter table document_categories enable row level security;

-- 읽기는 테넌트 전원(폴더 이름을 못 읽으면 목록 자체가 안 그려진다), 쓰기 게이트는 앱
-- (canWriteTenant("documents") — 권한 매트릭스 override 반영). 여기에 역할을 하드코딩하지 않는 이유:
--   · 부모 테이블 academy_documents도 tenant_isolation 하나뿐이라 분류만 잠그는 건 앞뒤가 안 맞고,
--   · 0158a가 경고한 대로 역할을 DB에 박으면 학원설정 override(예: counselor=full)를 준 테넌트가
--     "설정은 켰는데 DB가 막는" 회귀를 맞는다. 문서 계열 전체를 DB로 내릴 땐 0158a의 auth_menu_access
--     패턴으로 academy_documents와 **함께** 내릴 것.
drop policy if exists document_categories_tenant_isolation on document_categories;
create policy document_categories_tenant_isolation on document_categories
  for all
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- ── 기존 6개 분류 시드(전 테넌트) — 키 동일 = 기존 행 무손실 ────────────────
insert into document_categories (tenant_id, key, label, sort_order, is_system)
select t.id, s.key, s.label, s.ord, true
from tenants t
cross join (values
  ('enrollment',   '등록·입학', 10),
  ('billing',      '수납·결제', 20),
  ('consultation', '상담',      30),
  ('hr',           '인사·직원', 40),
  ('class',        '수업',      50),
  ('other',        '기타',      60)
) as s(key, label, ord)
on conflict (tenant_id, key) do nothing;

-- 새로 만들어지는 학원도 기본 분류를 갖도록 — 시드를 이 마이그레이션 시점에만 돌리면
-- 이후 생성 테넌트는 폴더가 통째로 비어 "문서를 어디에도 넣을 수 없는" 상태가 된다.
create or replace function public.seed_document_categories() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into document_categories (tenant_id, key, label, sort_order, is_system)
  values
    (new.id, 'enrollment',   '등록·입학', 10, true),
    (new.id, 'billing',      '수납·결제', 20, true),
    (new.id, 'consultation', '상담',      30, true),
    (new.id, 'hr',           '인사·직원', 40, true),
    (new.id, 'class',        '수업',      50, true),
    (new.id, 'other',        '기타',      60, true)
  on conflict (tenant_id, key) do nothing;
  return new;
end;
$$;

drop trigger if exists tenants_seed_document_categories on tenants;
create trigger tenants_seed_document_categories
  after insert on tenants
  for each row execute function public.seed_document_categories();

-- ── ② 링크 문서(kind='link') ────────────────────────────────────────────────
alter table academy_documents add column if not exists link_url text;

alter table academy_documents drop constraint if exists academy_documents_kind_check;
alter table academy_documents add constraint academy_documents_kind_check
  check (kind in ('file', 'text', 'form', 'link'));

-- ── 폴더 카운트 group-by RPC ────────────────────────────────────────────────
-- 분류가 동적이 되면서 "분류마다 head count 1회"는 N+1이 된다(분류 20개 = 21쿼리).
-- security invoker(호출자 RLS — restricted 이력서 가드까지 그대로 적용) + auth_tenant_id() 이중격리(0039a/0040a 패턴).
create or replace function public.document_category_counts()
returns table (category text, count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select d.category, count(*) as count
  from academy_documents d
  where d.tenant_id = auth_tenant_id()
  group by d.category;
$$;
