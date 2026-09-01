-- 0239a: EiE 월간 계획서(MP) — 미리 쓰는 계획 칸 (2026-09-01).
--
-- 원장 2026-09-01: *"미리 입력하는 월간 뷰와, 실제로 수업진행하면서 입력하는 주간뷰를 비교할 수 있게
-- 하려고 함. 그래서 과연 진도가 제대로 나가고 있는지도 점검하기 위해서임."*
--
-- 축: **월간 = 계획(사전) / 주간 시트 = 실제(수업하며)**. 이 표는 **계획 한 층뿐**이다.
--  · 🔴 실제를 담는 표는 만들지 않는다 — 실제는 class_sheet_plan_lines가 이미 매일 담는다
--    (MCS 0237a와 같은 규칙: "새 표는 목표/계획 한 층뿐").
--  · 🔴 class_sheet_goals를 재활용하지 않는다 — 그 표의 grain은 (반·기간·역할·영역)이라 축이 다르다.
--    유니크의 skill_area 자리에 날짜를 밀어 넣는 꼴이 되고, nullable을 더하면 NULL이 안 겹쳐
--    **영어 목표 행이 중복**된다([[#113]] 계열).
--
-- grain = (반, 날짜, 칸 종류). 원본 구글 시트("이다교 T MP")의 한 칸이 그대로 한 행이다.
--  · col_kind = in_class | homework | ebook | test | off
--  · body     = 그 칸의 자유 텍스트(줄바꿈 허용 — 시트도 한 칸에 여러 줄을 쓴다).
--
-- 🔑 **열 구성을 저장하지 않는다.** 시트는 반마다·요일마다 열이 다르다(LE1은 화요일만 e-book 4열,
--    목·금은 3열 / PL3은 전 요일 3열). 그걸 설정 표로 만들면 화면·설정이 갈리므로, **그 요일에
--    ebook 행이 하나라도 있으면 그 요일에 4번째 열이 선다**로 파생시킨다. 그래서 body가 빈
--    ebook 행이 의미를 가진다(= 열은 섰는데 아직 안 적음) — 빈 문자열 행을 지우지 말 것.
--
-- 🔑 **off = 그 날 휴강의 '명시 예외'**(tri-state). 기본 판정은 학원설정 operations.holidays이고
--    (2026-09-01 원장이 2027년까지 31건 등록), 이 행은 그 기본을 뒤집을 때만 생긴다:
--      body='off'  → 설정에 없는 날인데 이 반은 쉰다
--      body='open' → 설정엔 휴일인데 이 반은 수업한다(실측: 2026-08-17 대체공휴일에 출결 21행)
--    행이 없으면 설정을 그대로 따른다. ⚠️ 그래서 off 행의 body는 자유 텍스트가 아니다.
--
-- 유니크는 (tenant_id, class_id, plan_date, col_kind) **일반 유니크**다 —
-- 🔴 부분(WHERE) 유니크 금지: ON CONFLICT 추론이 안 돼 upsert가 42P10으로 전건 실패한다([[#113]]).
--
-- 🔒 보안: class_sheet_* 와 **같은 규약**(0157a·0230a·0237a) — RLS는 켜되 정책 0개 +
--    PUBLIC/anon/authenticated 명시 revoke. 접근은 서버 admin client(service_role) 전용이고
--    권한 판정은 앱 레이어(requireEcsClassAccess + EiE 판정)에 있다.
--    ⚠️ 그래서 **모든 조회·쓰기에 tenant_id 명시 필터가 필수**다(admin은 RLS 우회 — [[#104]]).
--
-- ⚠️ 앱보다 **먼저** 적용할 것([[#95]]). 다만 표가 없어도 월간 화면은 죽지 않는다 —
--    MP 조회는 fail-soft(빈 목록 + 한글 배너)이고 달력·진도표 두 보기는 이 표를 아예 안 읽는다.
-- 롤백: 이 표만 지우면 된다(다른 표를 건드리지 않는다).

create table if not exists class_month_plan_cells (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  plan_date date not null,
  col_kind text not null,
  -- 빈 문자열이 의미를 가진다(열은 섰는데 아직 안 적음) — not null + default ''.
  body text not null default '' check (char_length(body) <= 2000),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_month_plan_cells_kind_ck
    check (col_kind in ('in_class', 'homework', 'ebook', 'test', 'off')),
  constraint class_month_plan_cells_pos_uq unique (tenant_id, class_id, plan_date, col_kind)
);

-- 교차 테넌트 참조 봉쇄 — 0157a가 만든 (tenant_id, id) unique 인덱스에 건다(멱등).
create unique index if not exists classes_tenant_id_id_uq on classes (tenant_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'class_month_plan_cells_class_fk') then
    alter table class_month_plan_cells
      add constraint class_month_plan_cells_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 조회는 항상 (반, 달 범위) — 한 반 한 달이 수업일 ~13일 × 칸 5종이라 아주 작다.
create index if not exists class_month_plan_cells_class_date_idx
  on class_month_plan_cells (tenant_id, class_id, plan_date);

-- 0230a·0237a와 같은 모양(멱등 재생성).
drop trigger if exists set_updated_at on class_month_plan_cells;
create trigger set_updated_at
  before update on class_month_plan_cells
  for each row execute function public.tg_set_updated_at();

alter table class_month_plan_cells enable row level security;
revoke all on table class_month_plan_cells from public, anon, authenticated;
grant all on table class_month_plan_cells to service_role;

comment on table class_month_plan_cells is
  'EiE 월간 계획서(MP)의 한 칸. grain=(반,날짜,칸 종류). 실제 진도는 class_sheet_plan_lines가 담는다(여기엔 계획만). service_role 전용(RLS 정책 0) — 게이트는 requireEcsClassAccess + english_track=eie.';
comment on column class_month_plan_cells.col_kind is
  'in_class|homework|ebook|test|off. ebook 행의 존재가 그 요일의 4번째 열을 세운다(빈 body도 의미 있음). off는 휴강 명시 예외(body=off|open, 없으면 학원설정 휴일을 따른다).';
