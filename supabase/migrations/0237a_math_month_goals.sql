-- 0237a: 수학 강사 시트(MCS) — 학생별 월간 목표 (2026-08-31).
--
-- 배경: 영어(ECS)는 반 전체가 같은 진도를 나가고 나뉘는 축이 **영역**(reading·grammar…)이라
-- class_sheet_goals의 키가 (반, 기간, role, skill_area)다. 수학은 축이 다르다 — 실측(2026-08):
--  · 같은 반 같은 날 2명 이상인 묶음 346개 중 **275개(79%)에서 학생마다 교재가 다르다.**
--    이름에 '개별'이 든 반은 89%, 안 든 반도 70%, 유일한 '단체' 반(고등M 단체 BS4F)조차 갈린다.
--  · 반 이름의 '개별'은 1:1이 아니라 "학생마다 제 교재·제 진도"라는 뜻이다(그런 반 34개의 인원은 4~9명,
--    실제 재원 1명인 반은 72개 중 3개뿐).
--  · 수학 유효 슬롯 230개에 교시 담당(slot_teacher_label·teacher_id)이 **0건** → 영어의 담임/부담임
--    role 축이 없다. 목표의 주인은 담임 한 명이고, 나뉘는 축은 **학생**이다.
-- → class_sheet_goals의 skill_area 칸에 학생 id를 담는 건 뜻이 다른 값을 같은 칸에 넣는 것이고
--   (CHECK `^[a-z0-9_]{1,24}$`에도 안 맞는다), student_id를 nullable로 덧붙이면 NULL이 낀 유니크가
--   겹침을 안 막아 **영어 행이 중복될 수 있다**. 표를 하나 더 두는 쪽이 싸고 정직하다.
--
-- 설계 결정:
--  · **실제 진도는 여기 안 담는다.** 학생별 교재·진도·과제는 이미 lesson_reports에 매일 쌓인다
--    (8월 1,737건 전부 수학). MCS는 그걸 월 단위로 세워 보여줄 뿐이고, 이 표는 **목표 한 층**뿐이다.
--    쓰기 경로 신설 = 이 표의 upsert 하나.
--  · 기간 = 달 1일(period_start). class_sheet_goals와 같은 CHECK 모양을 유지해 두 시트가 같은 규약을 쓴다.
--  · 유니크는 (tenant_id, class_id, student_id, period_start) — **부분 유니크(WHERE) 금지**([[#113]]:
--    부분 유니크는 ON CONFLICT 추론이 안 돼 upsert가 42P10으로 전건 실패한다).
--  · subject 컬럼 없음 — classes.subject 파생(ECS 0157a와 같은 규약).
--
-- 🔒 보안: class_sheet_* 와 **같은 규약** — RLS는 켜되 정책 0개 + PUBLIC/anon/authenticated 명시 revoke.
--    접근은 서버 admin client(service_role) 전용이고 권한 판정은 앱 레이어(requireMcsClassAccess)에 있다.
--    ⚠️ 그래서 **모든 조회·쓰기에 tenant_id 명시 필터가 필수**다(admin은 RLS 우회 — [[#104]]).
--
-- ⚠️ 앱보다 **먼저** 적용할 것([[#95]]). 다만 MCS 조회는 이 표가 없어도 죽지 않게 짜 두었다
--    (목표는 fail-soft로 빈 맵 → 경고만 안 뜨고 '미작성'·'진도 정체'는 그대로 보인다).
-- 롤백: drop table math_month_goals;

create table if not exists math_month_goals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  class_id uuid not null,
  student_id uuid not null,
  -- 그 달 1일. 달 단위만 — 수학은 주 단위 목표를 쓰지 않는다(영어의 scope='week' 대응물 없음).
  period_start date not null,
  textbook text check (char_length(textbook) <= 500),
  target_progress text check (char_length(target_progress) <= 500),
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint math_month_goals_period_ck check (extract(day from period_start) = 1),
  constraint math_month_goals_pos_uq unique (tenant_id, class_id, student_id, period_start)
);

-- 교차 테넌트 참조 봉쇄 — 0157a가 만든 (tenant_id, id) unique 인덱스에 건다(멱등).
create unique index if not exists classes_tenant_id_id_uq on classes (tenant_id, id);
create unique index if not exists students_tenant_id_id_uq on students (tenant_id, id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'math_month_goals_class_fk'
  ) then
    alter table math_month_goals
      add constraint math_month_goals_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'math_month_goals_student_fk'
  ) then
    alter table math_month_goals
      add constraint math_month_goals_student_fk
      foreign key (tenant_id, student_id) references students (tenant_id, id) on delete cascade;
  end if;
end $$;

create index if not exists math_month_goals_lookup_idx
  on math_month_goals (tenant_id, class_id, period_start);

drop trigger if exists set_updated_at on math_month_goals;
create trigger set_updated_at
  before update on math_month_goals
  for each row execute function public.tg_set_updated_at();

-- RLS(정책 0개) + 정밀 revoke/grant — service_role 전용. 헤더 🔒 참조.
alter table math_month_goals enable row level security;
revoke all on table math_month_goals from public, anon, authenticated;
grant all on table math_month_goals to service_role;
