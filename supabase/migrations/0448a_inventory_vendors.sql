-- 재고관리 '업체리스트' — 학원이 거래하는 업체 연락처(원장 2026-10-22: *"학원 주변에서 거래하고 있는 서점이나
-- 출판사 업체, 정수기, 인테리어 업체 등 업체명과 업체 전화번호, 담당자 연락처, 주소, 사업자등록번호 등을 볼 수
-- 있도록 … 바로바로 조회되고"* → *"재고관리에 전화번호부? 업체리스트? 그런걸로해서 만들어줘"*).
--
-- 🔑 재고관리의 다섯째 면이다 — 메뉴·권한은 `inventory`를 그대로 쓴다(사무실 full / 회계 readonly / 강사 none).
-- 🔑 분류(`category`)는 **자유 텍스트**다(서점·출판사·정수기·인테리어…) — 코드 enum으로 박지 않는다.
--    화면은 이미 적힌 분류를 칩·자동완성으로 다시 보여 줄 뿐이다.
-- ⚠️ 사업자등록번호는 공개 정보라(국세청 조회 가능) 별도 잠금 없이 같은 RLS를 쓴다.
--
-- 읽기 RLS = 테넌트 전원(select). 🔴 정책이 0개면 에러 없이 0행이다([[#104]]).
-- 쓰기 정책 없음 = 서버 액션(service_role) 전용, 게이트 = 앱의 canWriteTenant("inventory").
-- 🔴 `auth_menu_access('inventory')`를 RLS에 쓰지 말 것([[#92]]).
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다 — 업체리스트 면만 한글 배너 + 편집 잠금([[#95]]).
--
-- 롤백:
--   drop table if exists public.inventory_vendors;
set local statement_timeout = '60s';

create table if not exists public.inventory_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null constraint inventory_vendors_name_len check (char_length(btrim(name)) between 1 and 80),
  category text constraint inventory_vendors_category_len check (category is null or char_length(category) <= 40),
  phone text constraint inventory_vendors_phone_len check (phone is null or char_length(phone) <= 40),
  contact_name text constraint inventory_vendors_contact_name_len check (contact_name is null or char_length(contact_name) <= 40),
  contact_phone text constraint inventory_vendors_contact_phone_len check (contact_phone is null or char_length(contact_phone) <= 40),
  email text constraint inventory_vendors_email_len check (email is null or char_length(email) <= 120),
  address text constraint inventory_vendors_address_len check (address is null or char_length(address) <= 200),
  biz_no text constraint inventory_vendors_biz_no_len check (biz_no is null or char_length(biz_no) <= 20),
  note text constraint inventory_vendors_note_len check (note is null or char_length(note) <= 500),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.inventory_vendors is
  '재고관리 — 업체리스트(거래처 연락처). 분류는 자유 텍스트.';

create index if not exists inventory_vendors_tenant_name_idx
  on public.inventory_vendors (tenant_id, name);

alter table public.inventory_vendors enable row level security;

drop policy if exists inventory_vendors_tenant_read on public.inventory_vendors;
create policy inventory_vendors_tenant_read on public.inventory_vendors
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists inventory_vendors_set_updated_at on public.inventory_vendors;
create trigger inventory_vendors_set_updated_at before update on public.inventory_vendors
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
