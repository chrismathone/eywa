-- 0242a — 재고 관리(전자기기 자산관리대장) 도입
--
-- 원장(2026-09-02): *"워크트리 하나 파서 <자산관리대장 개편 시안> 참고한 다음 '재고 관리 탭'으로"*.
-- 시안 = 구글시트 「26.7월 전자기기관리대장」(침산인재원, 최종수정 2026-07-23, 분배관리 경영지원팀)을
-- 개편한 것. 한 줄 요지: **"자산 1대 = 영구 행 1개. 월별 시트 복사 대신 대여·실사 이력을 누적한다"**
-- (시트 24개 → 4개). 그 4개 시트가 아래 4개 표다.
--
-- 🔑 구조 결정:
--   ① inventory_assets — 자산 1대 = 행 1개(영구). 월별 복사본이 없으므로 "현황판이 실제와 최대 3대까지
--      어긋나 있던" 원본의 수기 숫자 문제가 구조적으로 사라진다(상단 스탯은 이 표에서 센다).
--   ② inventory_loans — 대여이력은 자산 1대에 여러 건이 쌓인다(반납해도 지우지 않는다). 대여자는 계정이
--      없는 사람(셔틀담당)·퇴사자일 수 있어 **이름을 스냅샷**으로 함께 저장하고 계정은 느슨하게 연결한다.
--      `prev_status` = 대여 전 자산 상태 — 반납 때 이걸로 되돌린다(대여 전이 '확인필요'였을 수 있어
--      되돌릴 상태를 추측하지 않는다. 없으면 사용중).
--   ③ inventory_audits — 실사이력. 결과가 '미확인'이어도 자산 상태를 **자동으로 바꾸지 않는다**
--      (자동 쓰기 금지 — 셔틀 결정·강사 소급 퇴원 사고와 같은 결. 사람이 확인 후 누른다).
--   ④ inventory_supplies — 개별 자산이 아니라 수량으로 세는 것(키보드·마우스).
--
-- "미기재" 규약: 원본이 비운 칸(`미기재`·`모델확인필요`·`제조사 확인필요`·`—`)은 **null**로 넣는다.
-- 문자열 "미기재"를 저장하면 정렬·필터·집계가 오염된다. 화면이 `미기재`/`—`로 갈라 그린다.
-- `상시`(반납예정 없음) → due_on = null + due_note = '상시'. 날짜 칸에 문자열을 넣지 않는다.
-- 시리얼번호(serial_no)는 원본 전건이 비어 있어 **컬럼만** 두고 화면 열로는 내지 않는다(다음 실사 때 수집).
--
-- 읽기 RLS = 테넌트 전원(select). 🔴 정책을 하나도 안 만들면 에러 없이 0행이 된다([[#104]]) — 4개 다.
-- 쓰기 정책 없음 = 서버 액션(service_role) 전용. 메뉴 게이트 = 앱의 canWriteTenant("inventory").
-- 🔴 `auth_menu_access('inventory')`를 RLS에서 쓰지 말 것 — 0170a DEFAULTS jsonb에 없는 키라 master
--    빼고 전원 'none'이 되어 fail-closed로 잠긴다([[#92]]). 앱 게이트로 충분하다.
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다(fail-soft: 빈 목록 + 한글 배너 + 편집 잠금, [[#95]]).
--
-- 롤백:
--   drop table if exists public.inventory_audits;
--   drop table if exists public.inventory_loans;
--   drop table if exists public.inventory_supplies;
--   drop table if exists public.inventory_assets;
--   drop sequence if exists public.inventory_loan_code_seq;
--   drop sequence if exists public.inventory_audit_code_seq;
set local statement_timeout = '60s';

-- ── ① 자산 마스터 ────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 사람이 읽는 자산ID(라벨에 붙는 번호) — 'NB-002'. 분류 접두 + 3자리 자동 채번, 직접 고칠 수도 있다.
  asset_code text not null constraint inventory_assets_code_fmt check (asset_code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
  -- desktop · laptop · monitor · tablet · printer · tv · etc (코드 고정 enum, src/features/inventory/category.ts)
  category text not null constraint inventory_assets_category
    check (category in ('desktop','laptop','monitor','tablet','printer','tv','etc')),
  maker text constraint inventory_assets_maker_len check (maker is null or char_length(maker) <= 80),
  model text constraint inventory_assets_model_len check (model is null or char_length(model) <= 120),
  -- 원본 전건 비어 있음. 컬럼만 두고 화면 열로는 안 낸다(폼에서는 적을 수 있다 — 다음 실사 때 수집 권장).
  serial_no text constraint inventory_assets_serial_len check (serial_no is null or char_length(serial_no) <= 120),
  acquired_on date,
  -- in_use · on_loan · repair · lost · check · unregistered · disposed (src/features/inventory/status.ts)
  status text not null constraint inventory_assets_status
    check (status in ('in_use','on_loan','repair','lost','check','unregistered','disposed')),
  -- '3층LAB(305)' 자유 텍스트. v1엔 위치 마스터가 없다(같은 곳이 여러 표기로 갈리면 그때 마스터를 둔다).
  location text constraint inventory_assets_location_len check (location is null or char_length(location) <= 120),
  -- 대여중일 때 빌려 간 사람 — 계정이 있으면 연결, 없으면(셔틀담당) 이름만.
  holder_user_id uuid references public.users(id) on delete set null,
  holder_name text constraint inventory_assets_holder_len check (holder_name is null or char_length(holder_name) <= 80),
  last_audited_on date,
  disposed_on date,
  note text constraint inventory_assets_note_len check (note is null or char_length(note) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_assets_code_uniq unique (tenant_id, asset_code),
  -- 폐기일이 있으면 상태도 폐기(상태 변경 액션이 짝으로 받는다).
  constraint inventory_assets_disposed_pair check (disposed_on is null or status = 'disposed')
);

comment on table public.inventory_assets is
  '재고 관리 — 자산 마스터(0242a). 자산 1대 = 영구 행 1개. 원본 시트가 비운 칸은 null(문자열 "미기재" 금지).';

create index if not exists inventory_assets_tenant_sort_idx
  on public.inventory_assets (tenant_id, sort_order, asset_code);
create index if not exists inventory_assets_tenant_status_idx
  on public.inventory_assets (tenant_id, status);

-- ── ② 대여이력 ───────────────────────────────────────────────────────────────────────────
-- 새 대여의 이력ID — 원본은 L-0029~L-0035를 쓰고 있어 그 위(1000~)에서 시작한다(겹치지 않게).
-- 테넌트를 가로지르는 전역 시퀀스지만 이력ID는 **라벨**이라 그래도 된다(테넌트 안 유니크는 아래 제약).
create sequence if not exists public.inventory_loan_code_seq start with 1000;
create sequence if not exists public.inventory_audit_code_seq start with 1000;

create table if not exists public.inventory_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 🔑 FK 이름을 명시한다 — PostgREST 임베드가 `inventory_assets!inventory_loans_asset_id_fkey(...)`로 부른다([[#94]]).
  asset_id uuid not null constraint inventory_loans_asset_id_fkey references public.inventory_assets(id) on delete cascade,
  loan_code text not null default ('L-' || lpad(nextval('public.inventory_loan_code_seq')::text, 4, '0')),
  borrower_user_id uuid references public.users(id) on delete set null,
  -- 스냅샷 — 계정이 없거나 퇴사해도 기록이 읽혀야 한다.
  borrower_name text not null constraint inventory_loans_borrower_len check (char_length(btrim(borrower_name)) between 1 and 80),
  -- '강사' '경영지원팀' '운영' — 자유 텍스트(직급 enum이 아니다).
  dept text constraint inventory_loans_dept_len check (dept is null or char_length(dept) <= 80),
  lent_on date,
  due_on date,
  -- '상시' 같은 날짜 아닌 반납예정 표기. 날짜 칸에 문자열을 넣지 않는다.
  due_note text constraint inventory_loans_due_note_len check (due_note is null or char_length(due_note) <= 40),
  returned_on date,
  -- out · returned · unreturnable · check (src/features/inventory/loan-status.ts)
  status text not null constraint inventory_loans_status check (status in ('out','returned','unreturnable','check')),
  -- 대여 전 자산 상태 — 반납 때 이걸로 되돌린다(없으면 in_use). 대여 전이 '확인필요'였을 수 있다.
  prev_status text constraint inventory_loans_prev_status
    check (prev_status is null or prev_status in ('in_use','on_loan','repair','lost','check','unregistered','disposed')),
  note text constraint inventory_loans_note_len check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_loans_code_uniq unique (tenant_id, loan_code)
);

comment on table public.inventory_loans is
  '재고 관리 — 대여이력(0242a). 자산 1대에 여러 건이 쌓인다(반납해도 지우지 않는다). 대여자 이름은 스냅샷.';

-- 🔴 한 자산에 '대여중'이 둘일 수 없다.
-- ⚠️ 부분 유니크는 `ON CONFLICT` 추론이 안 된다([[#113]]) — 이 축으로 **upsert 금지**. 대여 시작은
--    읽고 → 없으면 insert(23505는 경쟁으로 보고 한글 메시지로 되돌린다).
create unique index if not exists inventory_loans_open_uniq
  on public.inventory_loans (asset_id) where status = 'out';
create index if not exists inventory_loans_tenant_asset_idx
  on public.inventory_loans (tenant_id, asset_id, lent_on desc);

-- ── ③ 실사이력 ───────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null constraint inventory_audits_asset_id_fkey references public.inventory_assets(id) on delete cascade,
  -- 원본 'A-2607-006'(년월-번호). 새 기록은 'A-YYMM-NNNN'(KST 년월 + 전역 시퀀스).
  audit_code text not null default (
    'A-' || to_char((now() at time zone 'Asia/Seoul'), 'YYMM') || '-' ||
    lpad(nextval('public.inventory_audit_code_seq')::text, 4, '0')
  ),
  audited_on date not null,
  -- ok · missing · hold (src/features/inventory/audit-result.ts)
  result text not null constraint inventory_audits_result check (result in ('ok','missing','hold')),
  location text constraint inventory_audits_location_len check (location is null or char_length(location) <= 120),
  auditor_user_id uuid references public.users(id) on delete set null,
  auditor_name text constraint inventory_audits_auditor_len check (auditor_name is null or char_length(auditor_name) <= 80),
  -- '사용자 연락' '2층 전수조사' '재점검' — 자유 텍스트.
  action text constraint inventory_audits_action_len check (action is null or char_length(action) <= 200),
  note text constraint inventory_audits_note_len check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint inventory_audits_code_uniq unique (tenant_id, audit_code)
);

comment on table public.inventory_audits is
  '재고 관리 — 실사이력(0242a). 결과가 미확인이어도 자산 상태는 사람이 확인 후 바꾼다(자동 쓰기 없음).';

create index if not exists inventory_audits_tenant_asset_idx
  on public.inventory_audits (tenant_id, asset_id, audited_on desc);

-- ── ④ 소모품 ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_supplies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_code text constraint inventory_supplies_code_len check (item_code is null or char_length(item_code) <= 32),
  name text not null constraint inventory_supplies_name_len check (char_length(btrim(name)) between 1 and 80),
  maker_model text constraint inventory_supplies_maker_model_len check (maker_model is null or char_length(maker_model) <= 120),
  qty integer not null default 0 constraint inventory_supplies_qty_nonneg check (qty >= 0),
  location text constraint inventory_supplies_location_len check (location is null or char_length(location) <= 120),
  checked_on date,
  checker_name text constraint inventory_supplies_checker_len check (checker_name is null or char_length(checker_name) <= 80),
  note text constraint inventory_supplies_note_len check (note is null or char_length(note) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_supplies_code_uniq unique (tenant_id, item_code)
);

comment on table public.inventory_supplies is
  '재고 관리 — 소모품(0242a). 개별 자산이 아니라 수량으로 세는 것(키보드·마우스).';

create index if not exists inventory_supplies_tenant_sort_idx
  on public.inventory_supplies (tenant_id, sort_order, item_code);

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 ──────────────────────────
alter table public.inventory_assets enable row level security;
alter table public.inventory_loans enable row level security;
alter table public.inventory_audits enable row level security;
alter table public.inventory_supplies enable row level security;

drop policy if exists inventory_assets_tenant_read on public.inventory_assets;
create policy inventory_assets_tenant_read on public.inventory_assets
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists inventory_loans_tenant_read on public.inventory_loans;
create policy inventory_loans_tenant_read on public.inventory_loans
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists inventory_audits_tenant_read on public.inventory_audits;
create policy inventory_audits_tenant_read on public.inventory_audits
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists inventory_supplies_tenant_read on public.inventory_supplies;
create policy inventory_supplies_tenant_read on public.inventory_supplies
  for select using (tenant_id = public.auth_tenant_id());

-- ── updated_at — 기존 공용 트리거 함수 재사용 ────────────────────────────────────────────
drop trigger if exists inventory_assets_set_updated_at on public.inventory_assets;
create trigger inventory_assets_set_updated_at before update on public.inventory_assets
  for each row execute function public.tg_set_updated_at();

drop trigger if exists inventory_loans_set_updated_at on public.inventory_loans;
create trigger inventory_loans_set_updated_at before update on public.inventory_loans
  for each row execute function public.tg_set_updated_at();

drop trigger if exists inventory_supplies_set_updated_at on public.inventory_supplies;
create trigger inventory_supplies_set_updated_at before update on public.inventory_supplies
  for each row execute function public.tg_set_updated_at();
