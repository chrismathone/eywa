-- 0229a — 셔틀 **일회성 탑승 개입**(오늘만 탄다 / 오늘만 안 탄다)
--
-- 원장(2026-08-20): *"결석자 말고도 오늘 연락이 와서 갑자기 탄다던지, 안타던지 하는 일회성 셔틀
-- 개입도 필요함."*
--
-- 🔴 **예정과 기록을 섞지 않는다** — 이게 이 표가 따로 있는 이유 전부다.
--    `shuttle_boardings`(0225a)는 **일어난 일**이다. 거기에 미리 `missed`/`extra`를 찍어 해결하면
--    아침에 "안 탔다"고 기록해 둔 아이가 실제로는 탔을 때 기록이 거짓이 되고(반대도 마찬가지),
--    그 거짓이 출결 신호(`missedSignals`)로 그대로 새어나간다. 그래서 **예정을 바꾸는 축**을 따로 둔다:
--      · 정기 배정(`shuttle_riders`) = 요일 규칙   ← 평소
--      · 일회성 예외(이 표)          = 그날만의 덧셈·뺄셈
--      · 등하원 기록(`shuttle_boardings`) = 실제로 일어난 일
--    명단 = 요일 매칭 − skip + add (순수 함수 `plannedRidesOn`, Vitest).
--
-- 🔑 축은 **(날짜 · 학생 · 종류 · 승하차)** 다.
--    · `skip`은 그날 그 방향의 정기 탑승을 **뺀다**(등원만 빼고 하원은 그대로가 가능해야 한다 —
--      "오늘 하원은 엄마가 데리러 와요"가 흔하다). 그래서 회차가 아니라 방향이 축이다.
--    · `add`는 **어디서 타는지**가 있어야 기사가 태울 수 있으므로 노선 칸(run_stop)을 가리킨다.
--    · 둘이 **같이 있을 수 있다**(skip + add = "오늘은 저기 말고 여기서"). 그래서 `kind`가 키에 들어간다.
--
-- 🔴 유니크는 **부분 인덱스로 만들지 않는다**([[#113]]) — 앱이 이 축으로 upsert하는데 Postgres는
--    부분 유니크 인덱스를 `ON CONFLICT (컬럼들)`로 **추론하지 못해** 42P10으로 전건 실패한다
--    (0225a의 shuttle_boardings에서 실제로 겪었다). 술어 없이도 의미는 같다.
--
-- 🔴 **출결은 건드리지 않는다**(원장 2026-08-19 확정, attendance-link.ts). 셔틀 예외가 결석을 만들지
--    않고 결석이 셔틀 예외를 만들지 않는다 — 부모가 직접 데려오면 셔틀 미탑승·출석이라 두 사실이 다르다.
--
-- ⚠️ **앱은 이 마이그레이션 전에도 돌아야 한다**([[#95]]) — 조회는 표가 없으면 예외 0건으로 조용히
--    접히고(`isMissingTable`), 셔틀 화면은 종전대로 살아 있다. 강사 전원 원스크린이 먹통이 됐던
--    2026-08-03 사고와 같은 자리다.
--
-- 읽기 RLS = 테넌트 전원(0225a 셔틀 표들과 **같은 모양**). 쓰기 정책 없음 = 서버 액션(service_role) 전용.
-- ⚠️ 정책을 하나도 안 만들면 RLS는 **에러 없이 0행**을 돌려준다([[#104]]) — select 정책을 반드시 만든다.
-- 쓰기 게이트는 앱이 판정한다: **편성(사무실)이 아니라 `canRecordBoarding`**(사무실 ∪ 셔틀 담당 ∪
-- super_admin) — 이건 편성 수정이 아니라 **오늘의 운영**이고, 실측상 셔틀 선생님은 역할이 `viewer`라
-- 사무실 권한을 요구하면 정작 전화를 받고 찍을 사람이 못 찍는다(record-gate.ts).
--
-- 롤백:
--   drop table if exists public.shuttle_ride_exceptions;
set local statement_timeout = '60s';

create table if not exists public.shuttle_ride_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  on_date date not null,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 'skip'(오늘만 안 탐) | 'add'(오늘만 탐).
  kind text not null constraint shuttle_ride_exceptions_kind check (kind in ('skip','add')),
  -- 'in'(등원) | 'out'(하원) — shuttle_riders.io_kind와 같은 축.
  io_kind text not null constraint shuttle_ride_exceptions_io check (io_kind in ('in','out')),
  -- add일 때 **어디서 타는지**. skip은 방향만으로 충분하므로 null.
  -- on delete cascade: 노선 칸이 사라지면 태울 자리가 없으므로 예외도 무의미해진다. 그날 실제로
  -- 탔는지는 shuttle_boardings가 스냅샷과 함께 따로 보존하므로 기록이 사라지지는 않는다.
  run_stop_id uuid references public.shuttle_run_stops(id) on delete cascade,
  constraint shuttle_ride_exceptions_stop_required check ((kind = 'add') = (run_stop_id is not null)),
  -- 사유. ⚠️ **필수로 만들지 않는다** — 급할 때 못 찍으면 기능이 없는 것과 같다(원장 브리프).
  memo text constraint shuttle_ride_exceptions_memo_len check (memo is null or char_length(memo) <= 300),
  -- 누가 걸었나. ⚠️ 앱이 이 축으로 **upsert**하므로 같은 학생·같은 방향을 다시 찍으면 **마지막으로
  -- 찍은 사람**으로 덮인다(누가 언제 바꿨는지의 전체 이력은 감사로그가 갖는다).
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_ride_exceptions is
  '셔틀 일회성 탑승 개입(0229a) — 그날만의 예정 변경(오늘만 탐/안 탐). 실제 탑승 기록은 shuttle_boardings이고 이 표는 "예정"만 바꾼다(둘을 섞지 말 것).';

-- 🔴 부분 인덱스 금지([[#113]]) — 앱이 이 축으로 upsert한다.
create unique index if not exists shuttle_ride_exceptions_day_student_uniq
  on public.shuttle_ride_exceptions (tenant_id, on_date, student_id, kind, io_kind);
-- 일별 화면(그날 전체)이 핫패스.
create index if not exists shuttle_ride_exceptions_tenant_day_idx
  on public.shuttle_ride_exceptions (tenant_id, on_date);

alter table public.shuttle_ride_exceptions enable row level security;

drop policy if exists shuttle_ride_exceptions_tenant_read on public.shuttle_ride_exceptions;
create policy shuttle_ride_exceptions_tenant_read on public.shuttle_ride_exceptions
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists shuttle_ride_exceptions_set_updated_at on public.shuttle_ride_exceptions;
create trigger shuttle_ride_exceptions_set_updated_at before update on public.shuttle_ride_exceptions
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
