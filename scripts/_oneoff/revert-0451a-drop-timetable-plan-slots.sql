-- 0451a 되돌리기 — 시간표(개발중) 계획 칸 표를 0232a 그대로 다시 만든다(빈 표).
-- 🔴 적용 SQL이 아니다. 되돌릴 때만 원장 승인 뒤 손으로 실행한다.
-- 행은 백업에서 따로 되살린다: D:\tmp\timetable-plan-slots-backup-2026-10-23\restore.cjs --write (1,112행).
-- 화면 코드는 2026-10-23에 지웠으니 표만 되살려도 앱에서 쓰는 곳은 없다.

-- ↓ 0232a_timetable_plan_slots.sql 원문
-- 0232a — 시간표(개발중) 월별 계획 슬롯
--
-- 원장 지시(2026-08-28): *"현재 이후는 히스토리 — 9월 10월 시간표를 넣을 방법이 없음. 디비에서 월별로
-- 구분하게 컬럼 추가로 만들고 다음달 다다음달 시간표도 미리 만들어서 관리하고싶음"* + *"해당 기능은
-- 시간표에는 적용하지말고 시간표(개발중)이라는곳에서만 적용되게해줘"*.
--
-- 🔴 **왜 class_schedules에 컬럼을 더하지 않았나** — 그 표는 시간표만의 것이 아니다. 실측 **73개 파일**
--    (출결 귀속·청구 계획·급여·ECS·원스크린 로스터·좌석표)이 같은 표를 읽는다. 거기에 '10월 계획' 행을
--    넣으면 그 행이 **9월의 출결·청구·급여 쿼리에 그대로 섞인다**(대부분 plan_month를 모르니 필터도 못 건다).
--    돈에 닿는 표에 미래 행을 섞는 것은 "개발중 화면에서만"이라는 지시와 정면으로 어긋난다.
--    그래서 **월 컬럼을 가진 별도 표**로 격리한다 — 월별 구분은 그대로 되고, 본 시간표는 손도 안 댄다.
--
-- 확정(적용) 경로는 **일부러 만들지 않았다** — 계획을 class_schedules로 밀어 넣는 순간 위 73곳이 움직인다.
-- 원장이 "이 달 계획을 실제로 적용" 하겠다고 할 때 별건으로 설계한다(그때 이력 축 valid_from/valid_to와
-- 어떻게 만날지 같이 정해야 한다).
--
-- ⚠️ 접근은 0157a·0230a 계열과 같은 규약: RLS 켜고 **정책 0개** + service_role 전용 grant([[#104]]).
--    유일한 권한 판정은 앱(`requireTimetablePlanAccess`)이다 — 표면이 늘어도 게이트는 하나(#77).
-- ⚠️ 유니크는 부분(WHERE) 인덱스가 아니다 — upsert의 on conflict 추론이 깨진다([[#113]]).

create table if not exists timetable_plan_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- 'YYYY-MM' — 이 계획이 어느 달의 시간표인가. 문자열인 이유: 월 자체가 앵커라 date로 두면 '몇 일'이
  -- 의미 없는 자리에 들어가고, 비교·목록·정렬이 전부 to_char로 돌아간다.
  plan_month text not null,
  class_id uuid not null,
  day_of_week day_of_week not null,
  start_time time not null,
  end_time time not null,
  -- 셀 단위 override — class_schedules와 같은 뜻(NULL = 반 기본 상속).
  teacher_id uuid references users(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null,
  slot_teacher_label text,
  slot_room_label text,
  period_label text,
  merge_group uuid,
  -- 복사 출처(현재 시간표에서 떠 온 행) — 되짚기용. 원본이 지워져도 계획은 남는다.
  source_schedule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 달·같은 반·같은 요일·같은 시작시각은 한 줄. 합반은 merge_group으로 묶이되 행은 반별로 따로 선다.
  unique (tenant_id, plan_month, class_id, day_of_week, start_time)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timetable_plan_slots_class_fk') then
    alter table timetable_plan_slots
      add constraint timetable_plan_slots_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 'YYYY-MM' 형식 강제 — 잘못된 값이 들어오면 월 목록·비교가 조용히 어긋난다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'timetable_plan_slots_month_fmt') then
    alter table timetable_plan_slots
      add constraint timetable_plan_slots_month_fmt
      check (plan_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
  end if;
end $$;

-- 조회는 항상 (테넌트, 달) — 한 달 격자 전체. 비교는 두 달을 각각 읽는다.
create index if not exists timetable_plan_slots_month_idx
  on timetable_plan_slots (tenant_id, plan_month);
create index if not exists timetable_plan_slots_month_class_idx
  on timetable_plan_slots (tenant_id, plan_month, class_id);

alter table timetable_plan_slots enable row level security;
revoke all on table timetable_plan_slots from public, anon, authenticated;
grant all on table timetable_plan_slots to service_role;

comment on table timetable_plan_slots is
  '시간표(개발중) 월별 계획 슬롯(0232a). 앵커=테넌트+월(YYYY-MM)+반+요일+시작시각. class_schedules와 완전 분리 — 본 시간표·출결·급여·청구는 이 표를 읽지 않는다. service_role 전용(RLS 정책 0), 게이트는 앱.';
comment on column timetable_plan_slots.plan_month is
  '이 계획이 적용될 달(YYYY-MM). 미래 달을 미리 만들어 두는 것이 이 표의 존재 이유다.';
comment on column timetable_plan_slots.source_schedule_id is
  '복사해 온 class_schedules 행 id(있으면). FK를 걸지 않는다 — 원본이 행 분할로 마감돼도 계획은 그대로 남아야 한다.';

notify pgrst, 'reload schema';
