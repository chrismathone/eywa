-- 0255a — 자리(랩실) **교시 선택**: 하루짜리 이동 + 상시 고정
--
-- 원장 2026-09-10: *"그리고 한번 드래그한 학생은 '다음에도 이 LAB실 수업을 이 시간대로 고정할까요?'라고
-- 물어볼것. 고정하면 그 학생은 계속 그 시간대에서 랩실 수업 듣게."* → 왜 필요한가(원장 그림 설명):
-- *"그 학생만 그 시간대에 어쩔 수 없는 사정으로 다른 학생과 다른 시간에 랩실을 듣는 학생이 있어.
-- 그래서 이렇게 하루에 랩이 2회인 EiE 수업이 존재하는것."*
--
-- 🔑 **실측이 이 표의 존재 이유다**(2026-09-10, injaewon 유효 슬롯): 같은 요일에 LAB이 두 번 도는
--    (반×요일)이 **8개**다 — JP1 목(14:20·16:20) · JP3 화/금 · LS4a 화 · LS4b 목 · LT6 목(16:20·18:20)
--    · MEC1-5 수(16:20·17:00) · PL1b 화. 지금 명단 코드는 **그 반 학생 전원을 두 교시 모두에** 세운다
--    (`loadSeatDay`가 반 명단을 교시마다 그대로 복사한다). 누가 어느 쪽에 오는지는 **어디에도 없다**.
--
-- 🔴🔴 **이 표는 출결이 아니고 시간표도 아니다.** 시간표는 이미 맞다(그 반은 정말 하루 두 번 LAB에
--    들어간다). 없는 것은 **"이 학생은 그 둘 중 어느 쪽인가"** 하나뿐이라, 담는 것도 그것뿐이다.
--    `attendance_records`·`class_schedules`·`enrollments`는 한 줄도 안 바뀐다.
-- 🔴 **감추기만 한다, 세우지 않는다.** 학생은 이미 제 반의 모든 자리 교시 명단에 들어 있으므로
--    "16:20으로 정한다" = **그 반의 다른 자리 교시에서 감춘다**이다. 명단에 없던 학생을 끌어오는 경로가
--    아니다(자리 화면은 명단 밖 학생을 다루지 않는다 — 보강 규약 2026-08-19 그대로).
-- 🔴 **표를 둘로 나눈 이유 = 부분 유니크 금지**([[#113]]). 하루짜리와 상시는 유니크 축이 다르다
--    (`session_date` ↔ `day_of_week`). 한 표에 담고 `WHERE`로 가르면 `on conflict` 추론이 깨져
--    upsert가 전건 42P10이 된다.
-- 🔴 **고정에는 시작일이 있다**(`effective_from`) — 없으면 오늘 누른 고정이 **지난 목요일 화면까지**
--    바꾼다. 이미 찍힌 출결은 옛 교시에 `slot_start`로 박혀 있어서, 명단만 옮기면 그 기록이 아무도
--    안 보는 칸에 남는다. 과거는 기록이지 계획이 아니다.
-- ⚠️ 그래도 **사실이 규칙을 이긴다** — 그 날짜에 이미 기록이 있는 교시에서는 감추지 않는다
--    (판정은 [`period-choice.ts`](../../src/features/attendance/seat/period-choice.ts) 단일 소스).
-- ⚠️ RLS는 **정책 0개**(0254a·0246a·0157a와 같은 규약) — 앱은 admin 클라이언트 + 명시 `tenant_id`
--    필터로만 읽고 쓴다([[#104]]). 세션 클라이언트로 읽으면 에러 없이 0행이다.
-- ⚠️ 이 SQL이 아직 안 돌았어도 화면은 산다([[#95]]) — 조회는 fail-soft(선택 0줄 = 지금까지의 화면
--    그대로, 전원이 두 교시 모두에 선다)이고 교시 이동·고정만 잠긴다.
set local statement_timeout = '60s';

-- ── ① 하루짜리 — "오늘만 이 교시" (고정 안 함을 고른 경우) ──────────────────────────────────────
create table if not exists seat_period_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  -- 자리 키(URL·설정과 같은 소문자 값) — DB 라벨(`LAB`/`JJ`)이 아니라 앱의 `SeatKey`.
  seat text not null check (seat in ('lab', 'jj')),
  session_date date not null,
  -- 그 학생의 **수강 반**(= 출결이 저장되는 반). 교시 이동은 반을 바꾸지 않는다.
  class_id uuid not null,
  student_id uuid not null references students(id) on delete cascade,
  -- 그날 이 학생이 설 교시 — 자리 출결과 **같은 축**(`attendance_records.slot_start`).
  slot_start time not null,
  moved_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 🔴 술어 없는 일반 유니크 — upsert가 이 축으로 추론한다([[#113]]).
  unique (tenant_id, seat, session_date, class_id, student_id)
);

-- ── ② 상시 — "앞으로도 이 요일엔 이 교시" (원장의 '고정') ─────────────────────────────────────
create table if not exists seat_period_pins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  seat text not null check (seat in ('lab', 'jj')),
  -- 🔑 요일 단위다 — 시간표가 요일 축이라 같은 반도 화요일과 금요일의 교시가 다를 수 있다
  --    (실측 JP3: 화·금 둘 다 14:20/16:20이지만 반마다 같으리란 보장이 없다). "다음에도"를 요일 밖으로
  --    넓히면 손대지 않은 날의 명단이 조용히 바뀐다.
  day_of_week text not null check (day_of_week in ('sun','mon','tue','wed','thu','fri','sat')),
  class_id uuid not null,
  student_id uuid not null references students(id) on delete cascade,
  slot_start time not null,
  -- 🔴 이 날짜부터 적용(= 고정을 누른 화면의 날짜). 그 전 날짜는 기록이라 건드리지 않는다.
  effective_from date not null,
  pinned_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, seat, day_of_week, class_id, student_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'seat_period_moves_class_fk') then
    alter table seat_period_moves
      add constraint seat_period_moves_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'seat_period_pins_class_fk') then
    alter table seat_period_pins
      add constraint seat_period_pins_class_fk
      foreign key (tenant_id, class_id) references classes (tenant_id, id) on delete cascade;
  end if;
end $$;

-- 화면은 (테넌트·자리·요일)로 하루치를 한 번에 읽는다 — 유니크 접두가 못 덮는 축이라 인덱스를 둔다.
create index if not exists seat_period_pins_day_idx
  on seat_period_pins (tenant_id, seat, day_of_week);

drop trigger if exists seat_period_moves_set_updated_at on seat_period_moves;
create trigger seat_period_moves_set_updated_at
  before update on seat_period_moves
  for each row execute function public.tg_set_updated_at();

drop trigger if exists seat_period_pins_set_updated_at on seat_period_pins;
create trigger seat_period_pins_set_updated_at
  before update on seat_period_pins
  for each row execute function public.tg_set_updated_at();

-- RLS: 정책 0개(의도) — 0254a와 같은 규약. select 정책도 만들지 않는다.
alter table seat_period_moves enable row level security;
revoke all on table seat_period_moves from public, anon, authenticated;
grant all on table seat_period_moves to service_role;

alter table seat_period_pins enable row level security;
revoke all on table seat_period_pins from public, anon, authenticated;
grant all on table seat_period_pins to service_role;

comment on table seat_period_moves is
  '자리 출석부 교시 선택(하루짜리) — 하루에 자리 수업이 두 번 있는 반에서 그 학생이 그날 설 교시. 출결·시간표는 안 바뀐다. RLS 정책 0개 = service_role 전용.';
comment on table seat_period_pins is
  '자리 출석부 교시 고정(상시) — 그 요일 그 반에서 이 학생이 서는 교시. effective_from 이후 날짜에만 적용(과거는 기록). RLS 정책 0개 = service_role 전용.';

notify pgrst, 'reload schema';
