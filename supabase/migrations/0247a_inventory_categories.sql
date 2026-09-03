-- 0247a — 자산 분류를 **학원별 데이터**로 (코드 고정 7종 → inventory_categories)
--
-- 원장(2026-09-03): *"분류를 정식으로 추가하고, 엑셀에서 없는 분류 추가하면 자동으로 분류 추가되도록 해야겠어"*
-- + *"대신 분류 추가시에 반영 누르면 '확인' 메시지 하나 띄워주는걸로"*.
--
-- 지금까지 분류는 **두 겹으로 고정**돼 있었다 — 코드(src/features/inventory/category.ts 7종)와
-- 0242a의 CHECK 제약. 그래서 엑셀에 '헤드셋'을 적으면 `분류 "헤드셋"를 모릅니다`로 **파일 전체가**
-- 반영되지 않았다(오류 1건이면 전무). 이 표가 그 두 겹을 하나로 바꾼다.
--
-- 🔑 구조 결정:
--   ① 저장 자리는 새 표 하나 — `tenant_settings.data` jsonb가 아니라 표다. 자산이 FK로 가리켜야
--      "쓰고 있는 분류를 못 지운다"가 DB에서 보장되고, 접두(code_prefix) 유니크도 여기서 잡힌다.
--   ② `key`는 확정 후 **불변**이다. 라벨을 바꿔도 키는 그대로 둔다(바꾸면 기존 자산 연결이 끊긴다 —
--      과목 키 `subjects[].key`와 같은 규약). 그래서 키는 사람이 안 정하고 앱이 도출한다
--      (작은 사전 → 없으면 `category_N`, src/features/inventory/category-plan.ts).
--   ③ `code_prefix`는 자산ID 머리글자(`NB-002`의 `NB`) — `nextAssetCode`가 이걸로 채번한다.
--      🔴 접두로 분류를 되짚지 말 것(자산ID는 사람이 고칠 수 있는 **라벨**이다, 0242a 주석 그대로).
--   ④ CHECK → FK 교체. `on delete restrict` = 쓰고 있는 분류는 못 지운다(의도한 동작).
--      `on update cascade`는 안전벨트일 뿐 — 키를 바꾸는 경로는 앱에 없다.
--
-- ⚠️ 삭제·이름변경 UI는 **이번 범위 밖**이다. 쓰고 있는 분류를 지우려면 과목의 `absorbSubject`처럼
--    "삭제 → 다른 분류에 흡수"가 필요하고(자산·감사로그가 함께 움직여야 한다) 그건 별건이다.
--
-- 읽기 RLS = 테넌트 전원(select). 쓰기 정책 없음 = 서버 액션(service_role) 전용 — 0242a 4개 표와 똑같다.
-- 🔴 정책을 하나도 안 만들면 에러 없이 0행이 된다([[#104]]).
-- 🔴 `auth_menu_access('inventory')`를 RLS에 쓰지 말 것 — 0170a DEFAULTS jsonb에 없는 키라 master 빼고
--    전원 'none'이 되어 fail-closed로 잠긴다([[#92]]). 앱 게이트(canWriteTenant)로 충분하다.
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 **내장 7종으로 폴백**해 화면·자산 등록은
--    그대로 돌고, 엑셀의 **새 분류 자동 추가만** 잠긴다(한글 배너가 그 사실을 적는다).
--
-- 롤백:
--   alter table public.inventory_assets drop constraint if exists inventory_assets_category_fk;
--   alter table public.inventory_assets add constraint inventory_assets_category
--     check (category in ('desktop','laptop','monitor','tablet','printer','tv','etc'));
--   drop index if exists public.inventory_assets_tenant_category_idx;
--   drop table if exists public.inventory_categories;
--   ⚠️ 롤백 전에 7종 밖 분류를 쓰는 자산이 있으면 CHECK 복구가 실패한다(그 자산을 먼저 옮길 것).
set local statement_timeout = '60s';

-- ── 분류 마스터 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 앱이 도출하는 내부 식별자(불변) — 'laptop' · 'headset' · 'category_3'. 화면에 안 보인다.
  key text not null constraint inventory_categories_key_fmt check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  -- 사람이 읽는 이름 — 엑셀에 적힌 글자 그대로(trim). 라벨은 고쳐도 key는 안 바뀐다.
  label text not null constraint inventory_categories_label_len check (char_length(btrim(label)) between 1 and 40),
  -- 자산ID 머리글자 — 'NB' · 'HS' · 'C1'. 채번(nextAssetCode)이 이걸 쓴다.
  code_prefix text not null constraint inventory_categories_prefix_fmt check (code_prefix ~ '^[A-Z][A-Z0-9]{0,3}$'),
  -- 필터 칩·드롭다운 순서.
  sort_order integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_categories_key_uniq unique (tenant_id, key),
  -- 같은 이름 두 벌 방지 — 화면에 똑같이 보이는 분류가 둘이면 어느 쪽에 넣었는지 알 수 없다.
  constraint inventory_categories_label_uniq unique (tenant_id, label),
  -- 접두가 겹치면 채번이 남의 번호를 이어 간다.
  constraint inventory_categories_prefix_uniq unique (tenant_id, code_prefix)
);

comment on table public.inventory_categories is
  '재고 관리 — 자산 분류(0247a). 학원별 데이터. key는 앱이 도출하고 확정 후 불변(라벨만 사람이 읽는다).';

create index if not exists inventory_categories_tenant_sort_idx
  on public.inventory_categories (tenant_id, sort_order, key);

-- ── 기존 7종 시드 — 라벨·접두·순서는 지금 코드(category.ts BUILTIN_CATEGORIES) 그대로 ──────────
-- ⚠️ 새 학원(테넌트)을 만들면 이 INSERT를 그 테넌트에 다시 돌린다(앱은 분류가 0개면 내장 7종으로
--    폴백해 화면은 살지만, 그 상태로 자산을 등록하면 FK가 거절한다).
insert into public.inventory_categories (tenant_id, key, label, code_prefix, sort_order)
select t.id, v.key, v.label, v.code_prefix, v.sort_order
from public.tenants t
cross join (values
  ('desktop', '데스크탑', 'DT', 10),
  ('laptop',  '노트북',   'NB', 20),
  ('monitor', '모니터',   'MN', 30),
  ('tablet',  '태블릿',   'TB', 40),
  ('printer', '프린터',   'PR', 50),
  ('tv',      'TV',       'TV', 60),
  ('etc',     '기타',     'ET', 70)
) as v(key, label, code_prefix, sort_order)
on conflict (tenant_id, key) do nothing;

-- ── 기존 자산이 쓰는 분류가 전부 시드에 있는지 확인한 뒤에만 FK를 건다 ──────────────────────
-- (없는 채로 FK를 걸면 ALTER가 통째로 실패해 원인을 못 읽는다 — 어느 값인지 한글로 알린다.)
do $$
declare orphan text;
begin
  select string_agg(distinct a.category, ', ')
    into orphan
  from public.inventory_assets a
  left join public.inventory_categories c
    on c.tenant_id = a.tenant_id and c.key = a.category
  where c.id is null;
  if orphan is not null then
    raise exception '자산이 쓰는 분류가 inventory_categories에 없습니다 — 먼저 그 분류를 넣으세요: %', orphan;
  end if;
end $$;

-- ── CHECK 제약을 걷어내고 FK로 교체 ──────────────────────────────────────────────────────
alter table public.inventory_assets drop constraint if exists inventory_assets_category;
alter table public.inventory_assets drop constraint if exists inventory_assets_category_fk;
alter table public.inventory_assets
  add constraint inventory_assets_category_fk
  foreign key (tenant_id, category)
  references public.inventory_categories (tenant_id, key)
  on update cascade on delete restrict;

-- 자식 쪽 인덱스 — 분류 삭제 시 참조 검사가 전건 스캔을 안 하게(그리고 분류 필터 조회에도 쓰인다).
create index if not exists inventory_assets_tenant_category_idx
  on public.inventory_assets (tenant_id, category);

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 (0242a와 동일) ──────────────
alter table public.inventory_categories enable row level security;

drop policy if exists inventory_categories_tenant_read on public.inventory_categories;
create policy inventory_categories_tenant_read on public.inventory_categories
  for select using (tenant_id = public.auth_tenant_id());

-- ── updated_at — 기존 공용 트리거 함수 재사용 ────────────────────────────────────────────
drop trigger if exists inventory_categories_set_updated_at on public.inventory_categories;
create trigger inventory_categories_set_updated_at before update on public.inventory_categories
  for each row execute function public.tg_set_updated_at();
