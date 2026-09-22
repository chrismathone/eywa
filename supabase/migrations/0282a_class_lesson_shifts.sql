-- 0282a — 수업 회차를 **한 칸 미루거나 당긴다** (0266a·0268a 후속)
--
-- 원장(2026-09-22): *"실제 에서는 수업 회차를 한주 미루거나 당기거나 할수있게 하고싶음
-- 미루면 차수 무시하고 수업내용 기입해서 쓸수있게"*.
--
-- 🔑 무엇을 담나: **그 (반, 날짜, 교시)에서 차수를 어떻게 할지** 한 줄. 월간계획 자체는 저장하지 않고
--    교재 배정에서 계산하므로(2026-09-22 결정), 사람이 내린 이 결정만 남기면 계획이 알아서 따라온다.
--      · `skip`    = **미루기**. 그 칸은 차수 없이 지나간다 → 그 뒤 차수가 한 칸씩 **밀린다**.
--                    그 칸은 계획이 비므로 강사가 실제 수업 내용을 자유로 적는다(원장 지시 그대로).
--      · `advance` = **당기기**. 그 칸에서 차수 하나를 버린다 → 그 뒤 차수가 한 칸씩 **당겨진다**.
--
-- 🔑 휴일과 **같은 규칙**을 탄다(`buildLessonSchedule`) — 휴일도 "차수를 소비하지 않고 건너뛴다"다.
--    다른 점은 휴일이 학원설정(날짜 전체)이고 이건 **교시 한 칸**이라는 것뿐이다.
--
-- 🔴 **반·날짜·교시 단위다**(배정 단위가 아니다) — "이번 주 수업을 미룬다"는 그 수업 전체의 결정이라,
--    한 칸에 교재가 둘이면 둘 다 함께 밀려야 맞다. 배정마다 따로 담으면 한 칸이 반만 밀린다.
-- 🔴 **실제 계획 줄(`class_sheet_plan_lines`)은 건드리지 않는다** — 이미 적어 둔 진도는 그대로 남고,
--    바뀌는 건 "앞으로 어느 칸에 몇 차수가 오는가"뿐이다.
-- ⚠️ 유니크에 **부분(WHERE) 술어를 쓰지 않는다**([[#113]]) — 이 축으로 upsert한다(토글이라 갈아끼운다).
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 조회가 표 없음을 상태로 접고 빈 목록으로 돈다
--    (그 경우 미루기·당기기 버튼이 "잠시 뒤 다시" 안내로 막힐 뿐 계획·시트는 그대로다).
--
-- 롤백:
--   drop table if exists public.class_lesson_shifts;
set local statement_timeout = '60s';

create table if not exists public.class_lesson_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null,
  plan_date date not null,
  -- `class_sheet_plan_lines.slot_start`와 같은 표기(`time`) — 같은 칸을 가리키는 값이라 형을 맞춘다.
  slot_start time not null,
  kind text not null
    constraint class_lesson_shifts_kind_chk check (kind in ('skip', 'advance')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'class_lesson_shifts_class_fk') then
    alter table public.class_lesson_shifts
      add constraint class_lesson_shifts_class_fk
      foreign key (tenant_id, class_id) references public.classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 한 칸에 결정은 하나다(미루기와 당기기를 동시에 걸 수 없다) — 토글이 이 축으로 upsert한다.
create unique index if not exists class_lesson_shifts_cell_uniq
  on public.class_lesson_shifts (tenant_id, class_id, plan_date, slot_start);
-- 달 단위 조회(월간계획 계산)가 타는 축.
create index if not exists class_lesson_shifts_month_idx
  on public.class_lesson_shifts (tenant_id, class_id, plan_date);

comment on table public.class_lesson_shifts is
  '수업 회차 미루기·당기기(0282a) — 그 칸에서 차수를 건너뛸지(skip) 버릴지(advance). 월간계획 계산이 읽는다(실제 줄은 안 건드린다).';

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 service_role(서버 액션)만 ──────────────────
-- 0266a 세 표와 **같은 모양**이다: 쓰기 정책을 아예 두지 않아 사람이 PostgREST로 직접 못 쓴다
-- (게이트는 서버 액션의 `requireEcsClassAccess(write)` 하나 — 문이 둘이면 규칙도 둘이 된다).
alter table public.class_lesson_shifts enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'class_lesson_shifts' and policyname = 'class_lesson_shifts_read'
  ) then
    create policy class_lesson_shifts_read on public.class_lesson_shifts
      for select using (tenant_id = public.auth_tenant_id());
  end if;
end $$;

notify pgrst, 'reload schema';
