-- s2_0003 — 비포클래스체크리스트(초안) — 원장 2026-10-28
--
-- 원장 *"해당 시트의 기능을 새로이 추가 … 메뉴 이름은 비포클래스체크리스트(초안) … 4개반만 테스트 진행"*.
-- 구글 시트 '강의하는 아이들 출석부'(학생 × 수업일마다 미흡 10항목 체크 + 결석 + 카드)를 옮긴다.
-- 판정(완료율 · 보충 필요 = 미흡 3개 이상)은 앱의 순수 함수(src/features/before-class/items.ts)가 한다 — 여기엔 사실만 남긴다.
--
-- 표 둘:
--   before_class_targets = 이 기능을 쓰는 반(지점별). 화면은 이 표에 있는 반만 세운다. 첫 시험 = 침산 4개 반(아래 insert).
--   before_class_checks  = 학생 × 반 × 수업일 한 줄(미흡 항목 키 배열 · 결석 · 카드). 같은 칸을 다시 저장하면 덮어쓴다(유니크 + upsert).
--
-- 🔴 읽기·쓰기 정책을 두지 않는다 — 서버(service_role)만 읽고 쓴다(s2_0002 · 0370a와 같은 규약: admin 클라이언트 + tenant_id
--    명시 필터). 권한은 앱의 메뉴 권한 `before_class_checklist`(전체 = 체크 · 읽기 = 열람)가 정한다. 정책이 0개인 것은 **의도적**이다
--    ([[#92]] "의도적 제외는 마이그레이션에 적는다"). 브라우저 역할로는 0행([[#104]]).
-- 🔴 유니크에 WHERE를 붙이지 않는다([[#113]] — upsert가 추론하지 못한다).
-- ⚠️ 앱은 이 표가 **없어도 죽지 않는다**([[#95]]) — 메뉴 화면이 "준비 중" 안내를 띄운다. 적용 순서 제약 없음.
-- 반·학생·지점이 지워지면 함께 지운다 · 체크한 직원 계정이 지워지면 checked_by만 비운다.
--
-- 롤백: drop table if exists public.before_class_checks; drop table if exists public.before_class_targets;
set local statement_timeout = '60s';

create table if not exists public.before_class_targets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, class_id)
);

comment on table public.before_class_targets is
  '비포클래스체크리스트(초안)를 쓰는 반 — 화면은 이 표의 반만 세운다. 서버 전용(정책 0개 = 의도). s2_0003';

alter table public.before_class_targets enable row level security;

create table if not exists public.before_class_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  check_date date not null,
  -- 미흡으로 체크한 항목 키(items.ts BEFORE_CLASS_ITEMS) — 빈 배열 = 모두 해 옴.
  missed text[] not null default '{}'::text[],
  absent boolean not null default false,
  -- 카드(시트의 블루·골드·레드·옐로우·카드 X). null = 아직 안 고름.
  card text constraint before_class_checks_card check (card in ('blue', 'gold', 'red', 'yellow', 'none')),
  checked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint before_class_checks_cell_key unique (tenant_id, class_id, student_id, check_date)
);

comment on table public.before_class_checks is
  '비포클래스체크리스트(초안) — 학생×반×수업일 1행(미흡 항목·결석·카드). 서버 전용(정책 0개 = 의도). s2_0003';

create index if not exists before_class_checks_class_date_idx
  on public.before_class_checks (tenant_id, class_id, check_date);

alter table public.before_class_checks enable row level security;

drop trigger if exists before_class_checks_set_updated_at on public.before_class_checks;
create trigger before_class_checks_set_updated_at before update on public.before_class_checks
  for each row execute function public.tg_set_updated_at();

-- 첫 시험 반(침산) — 이수진 '초등M 초5 MS1A'·'중등M 초6 MS2A' · 허은진 '중등M 초6 JJ2A'·'초등M 초5 JJ1A'(월·목).
-- 반이 없는 DB(다른 환경)에서는 아무것도 넣지 않는다.
insert into public.before_class_targets (tenant_id, class_id)
select c.tenant_id, c.id
from public.classes c
where c.id in (
  '5984ef1b-4750-4ae5-80cf-9e21a55e33aa',
  '2914f6bc-d7cd-4a1d-85b9-fcbd0ec72324',
  '3d8f916d-912b-41a3-a2ab-cefd7261fea0',
  '78db34d2-952d-4b8c-8ce6-9c4174a1f1a9'
)
on conflict do nothing;

notify pgrst, 'reload schema';
