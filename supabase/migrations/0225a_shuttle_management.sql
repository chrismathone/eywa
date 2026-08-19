-- 0225a — 셔틀(노랑버스) 관리 도입
--
-- 원장(2026-08-19): *"메이크에듀에서 셔틀 목록 관리중인데, 우리 eywa로 가져오면 더 손쉽게 출결
-- 연동해서 관리가능하지 않을까"* + 범위 확정 *"셔틀 행선지 관리, 학생 승하차 관리, 출결 연동,
-- 인쇄"* + *"셔틀 등하원 기록도 모두 DB화"*.
--
-- ⚠️ 이 표는 CLAUDE.md의 "셔틀 = 12메뉴 정체성상 제외" 결정을 **원장 명시 재검토로 뒤집은** 것이다
--    (캘린더 0218a와 같은 결). 다만 makeedu 노랑버스 11개 메뉴 중 **실사용 4개만** 가져온다 —
--    실측(2026-08-19): 탑승변경요청 0건 · 운행정보 상태 전부 공란 · 자동종료 7대 전부 '사용안함' ·
--    푸시알림 42명 전원 '알리지 않음'. 안 쓰는 기능은 표도 만들지 않는다.
--
-- 🔑 구조 결정 3가지 (전부 makeedu의 실측된 문제를 고치는 것):
--   ① **정류장 마스터(shuttle_stops)를 둔다.** makeedu는 행선지가 노선마다 자유 텍스트라 같은 곳이
--      최대 5벌로 갈려 있었다("서대구 센트럴 자이 112동상가"/"112동 상가"/"센트럴자이 112동 상가"…).
--      시각 하나를 고치려면 5곳을 따로 고쳐야 했고 한 곳 빠뜨리면 조용히 어긋났다. 노선은 마스터를
--      **참조만** 한다 → 이름·메모는 한 곳에서 고친다. 재발 방지는 (tenant, name) 부분 유니크.
--   ② **학기중/방학중은 시즌 축(runs.season)이다 — 차량 복제가 아니다**(원장 선택 2026-08-19).
--      makeedu는 '1호차'와 '1호_방학중'을 별개 차량으로 복제해 두 벌을 손으로 유지했는데, 실측상
--      명단은 70 vs 71명에 **겹침 70** = 사실상 같은 사람들이고 다른 건 시각·배치뿐이었다.
--   ③ **등하원 기록(shuttle_boardings)은 편성과 분리해 영구 보존**한다. 노선을 고쳐도 지난 기록은
--      그대로 읽혀야 하므로 차량·정류장 **이름을 스냅샷으로 함께 저장**한다(print_payload 동결과 같은 결).
--
-- 🔴 출결 연동은 **신호만, 자동 쓰기 없음**(원장 선택 2026-08-19). 셔틀 미탑승이 출결 결석을 만들지
--    않고, 출결 결석이 셔틀 기록을 만들지 않는다. 화면에서 서로를 보여줄 뿐 최종 판단은 사람이 한다
--    (강사 소급 퇴원 사고 이후 자동 쓰기는 신중히 — CLAUDE.md 결정 로그).
--
-- 읽기 RLS = 테넌트 전원(셔틀 편성은 직원 공용 운영 정보 — 급여·주민번호 같은 민감 축이 없다).
-- 쓰기 정책 없음 = 서버 액션(service_role) 전용. 메뉴 게이트는 canWriteTenant("shuttle").
--
-- 롤백:
--   drop table if exists public.shuttle_boardings;
--   drop table if exists public.shuttle_riders;
--   drop table if exists public.shuttle_run_stops;
--   drop table if exists public.shuttle_runs;
--   drop table if exists public.shuttle_vehicles;
--   drop table if exists public.shuttle_stops;
set local statement_timeout = '60s';

-- ── ① 정류장 마스터 ──────────────────────────────────────────────────────────────────────
create table if not exists public.shuttle_stops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null constraint shuttle_stops_name_len check (char_length(btrim(name)) between 1 and 80),
  -- 기사·데스크용 메모("CU 건너편", "칠성고 맞은편") — 같은 아파트 앞 반대편 정류장을 구분하는 자리.
  memo text constraint shuttle_stops_memo_len check (memo is null or char_length(memo) <= 300),
  sort_order integer not null default 0,
  -- 안 쓰는 정류장은 지우지 않고 접는다(지난 등하원 기록이 참조한다).
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_stops is
  '셔틀 정류장 마스터(0225a) — 노선은 이 행을 참조만 한다. makeedu는 마스터가 없어 같은 정류장이 최대 5벌로 갈려 있었다.';

-- 🔑 같은 이름을 두 번 만들 수 없다 = "5벌" 재발 방지. 접힌 정류장은 제외(옛 이름 재사용 허용).
create unique index if not exists shuttle_stops_tenant_name_uniq
  on public.shuttle_stops (tenant_id, btrim(name))
  where not archived;
create index if not exists shuttle_stops_tenant_sort_idx
  on public.shuttle_stops (tenant_id, sort_order);

-- ── ② 차량 ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.shuttle_vehicles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null constraint shuttle_vehicles_name_len check (char_length(btrim(name)) between 1 and 40),
  -- 기사는 직원 계정이 있을 수도(부담임 겸직) 없을 수도(외주 기사) 있다 → 이름·전화는 항상 텍스트로
  -- 두고, 계정이 있으면 driver_user_id로 추가 연결한다(알림·권한을 붙일 때 쓸 자리).
  driver_name text constraint shuttle_vehicles_driver_len check (driver_name is null or char_length(driver_name) <= 40),
  driver_phone text constraint shuttle_vehicles_phone_len check (driver_phone is null or char_length(driver_phone) <= 20),
  driver_user_id uuid references public.users(id) on delete set null,
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_vehicles is
  '셔틀 차량(0225a) — 학기중/방학중은 차량 복제가 아니라 shuttle_runs.season으로 가른다(원장 2026-08-19).';

create index if not exists shuttle_vehicles_tenant_sort_idx
  on public.shuttle_vehicles (tenant_id, sort_order);

-- ── ③ 회차(run) = 차량 × 시즌 × 회차번호 ────────────────────────────────────────────────
create table if not exists public.shuttle_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_id uuid not null references public.shuttle_vehicles(id) on delete cascade,
  -- 'term'(학기중) | 'vacation'(방학중). 표는 값을 잠그지 않는다 — 시즌이 늘면(특강 등) 마이그 없이
  -- 코드가 확장한다(calendar_events.color와 같은 결). 코드가 검증·매핑한다.
  season text not null default 'term',
  run_no integer not null constraint shuttle_runs_no_range check (run_no between 1 and 30),
  -- 'in'(등원 = 태워서 학원으로) | 'out'(하원 = 학원에서 집으로). 실측상 한 회차에 승차·하차가
  -- 섞이기도 하므로(1호차 3회차 = 승차 38 · 하차 2) 이 값은 **회차의 성격**이고, 학생 개인의
  -- 승/하차는 shuttle_riders.io_kind가 따로 정한다.
  direction text not null default 'in' constraint shuttle_runs_direction check (direction in ('in','out')),
  -- 선택 별칭("야간 1회차") — 없으면 화면이 "3회차 등원"으로 만든다.
  label text constraint shuttle_runs_label_len check (label is null or char_length(label) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_runs is
  '셔틀 회차(0225a) — 차량 하루치 운행 1바퀴(학원 출발 → 정류장들 → 학원 도착). season으로 학기중/방학중을 가른다.';

create unique index if not exists shuttle_runs_vehicle_season_no_uniq
  on public.shuttle_runs (vehicle_id, season, run_no);
create index if not exists shuttle_runs_tenant_season_idx
  on public.shuttle_runs (tenant_id, season);

-- ── ④ 노선 = 회차의 정류장 순서 + 시각 ──────────────────────────────────────────────────
create table if not exists public.shuttle_run_stops (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id uuid not null references public.shuttle_runs(id) on delete cascade,
  -- 'stop'(정류장) | 'depart'(학원 출발) | 'arrive'(학원 도착). 학원 칸은 정류장 마스터에 넣지
  -- 않는다(모든 노선의 양 끝이라 마스터에 두면 "가장 많이 쓰는 정류장"이 항상 학원이 된다).
  kind text not null default 'stop' constraint shuttle_run_stops_kind check (kind in ('stop','depart','arrive')),
  -- kind='stop'이면 반드시 마스터 참조. 학원 칸은 null.
  -- on delete restrict = 노선이 물고 있는 정류장은 삭제 대신 archived로 접게 강제(고아 방지).
  stop_id uuid references public.shuttle_stops(id) on delete restrict,
  constraint shuttle_run_stops_stop_required check ((kind = 'stop') = (stop_id is not null)),
  sort_order integer not null,
  -- 도착 예정 시각(HH:MM). 학원 출발/도착도 시각을 갖는다(기사 노선표에 찍힌다).
  at_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_run_stops is
  '셔틀 노선 한 칸(0225a) — 회차 × 정류장 × 순서 × 시각. 순서 변경은 드래그(sort_order 재부여).';

-- 한 회차에 같은 정류장을 두 번 넣지 못한다(승차·하차는 rider.io_kind가 가르므로 칸은 하나면 된다).
create unique index if not exists shuttle_run_stops_run_stop_uniq
  on public.shuttle_run_stops (run_id, stop_id)
  where stop_id is not null;
-- sort_order에는 유니크를 걸지 않는다 — 드래그 재정렬이 중간 상태에서 반드시 충돌한다(한 문장으로
-- 전체를 다시 쓰더라도 제약 검사 시점 때문에 깨진다). 순서는 앱이 0..N-1로 다시 부여한다.
create index if not exists shuttle_run_stops_run_sort_idx
  on public.shuttle_run_stops (run_id, sort_order);

-- ── ⑤ 배정(정기 탑승) ───────────────────────────────────────────────────────────────────
create table if not exists public.shuttle_riders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_stop_id uuid not null references public.shuttle_run_stops(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 'in'(승차) | 'out'(하차) — makeedu ioKind와 같은 축.
  io_kind text not null constraint shuttle_riders_io check (io_kind in ('in','out')),
  -- 🔑 학생마다 요일이 다르다(실측: 이동건A = 월·수·목만). 빈 배열은 "요일 미지정"이 아니라
  --    **아무 요일도 안 탐**이라 허용하지 않는다 — 안 타면 배정을 지운다.
  weekdays public.day_of_week[] not null
    constraint shuttle_riders_weekdays_nonempty check (array_length(weekdays, 1) >= 1),
  memo text constraint shuttle_riders_memo_len check (memo is null or char_length(memo) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_riders is
  '셔틀 정기 배정(0225a) — 어느 회차·정류장에서 승/하차하는지 + 요일. 그날 실제 탑승은 shuttle_boardings.';

-- 같은 칸에 같은 학생을 승차·하차로 각각 한 번씩만.
create unique index if not exists shuttle_riders_stop_student_io_uniq
  on public.shuttle_riders (run_stop_id, student_id, io_kind);
create index if not exists shuttle_riders_tenant_student_idx
  on public.shuttle_riders (tenant_id, student_id);

-- ── ⑥ 등하원 기록 (원장 2026-08-19 "셔틀 등하원 기록도 모두 DB화") ─────────────────────
create table if not exists public.shuttle_boardings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  boarded_on date not null,
  student_id uuid not null references public.students(id) on delete cascade,
  -- 편성이 바뀌어도 지난 기록은 읽혀야 한다 → 참조는 느슨하게(set null) 두고 **이름을 스냅샷**으로
  -- 함께 저장한다(AI 인쇄물 print_payload 동결과 같은 결). 차량·정류장을 지워도 기록은 안 깨진다.
  run_id uuid references public.shuttle_runs(id) on delete set null,
  stop_id uuid references public.shuttle_stops(id) on delete set null,
  vehicle_label text,
  stop_label text,
  run_no integer,
  io_kind text not null constraint shuttle_boardings_io check (io_kind in ('in','out')),
  -- 'boarded'(탑승) | 'missed'(미탑승) | 'extra'(추가탑승 — 정기 배정에 없는데 그날 탔다).
  -- makeedu의 승차/하차/미탑승 3버튼을 승·하차(io_kind) × 탑승여부(status)로 정규화한 것.
  status text not null constraint shuttle_boardings_status check (status in ('boarded','missed','extra')),
  -- 미탑승 사유(makeedu '미탑승메모') — 출결 화면이 신호로 함께 보여준다.
  memo text constraint shuttle_boardings_memo_len check (memo is null or char_length(memo) <= 300),
  recorded_by uuid references public.users(id) on delete set null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_boardings is
  '셔틀 등하원 기록(0225a, 원장 "등하원 기록도 모두 DB화") — 날짜 × 학생 × 회차. 차량·정류장 이름을 스냅샷으로 함께 저장해 편성이 바뀌어도 지난 기록이 그대로 읽힌다.';

-- 한 학생이 하루에 같은 회차를 두 번 찍지 않는다.
-- 🔴 **부분 인덱스(`where run_id is not null`)로 만들지 말 것** — 앱이 이 축으로 upsert하는데
--    Postgres는 부분 유니크 인덱스를 `ON CONFLICT (컬럼들)`로 **추론하지 못한다**(42P10
--    "there is no unique or exclusion constraint matching the ON CONFLICT specification").
--    PostgREST는 index_predicate를 붙여주지 않으므로 등하원 찍기가 **전부 실패**한다(2026-08-19 실증, [[#113]]).
--    술어를 빼도 의미는 같다: run_id가 null인 옛 기록(회차 삭제 후)은 NULL끼리 충돌하지 않아
--    그대로 각자 남는다(같은 실증에서 확인).
create unique index if not exists shuttle_boardings_day_student_run_uniq
  on public.shuttle_boardings (tenant_id, boarded_on, student_id, run_id, io_kind);
-- 일별 화면(그날 전체)이 핫패스.
create index if not exists shuttle_boardings_tenant_day_idx
  on public.shuttle_boardings (tenant_id, boarded_on);
-- 학생 상세·출결 신호(그 학생의 그날)가 두 번째 핫패스.
create index if not exists shuttle_boardings_student_day_idx
  on public.shuttle_boardings (tenant_id, student_id, boarded_on);

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 서버 액션(service_role) 전용 ───────────────────────
-- calendar_events(0218a)와 같은 형태다. 셔틀 편성·탑승은 직원 공용 운영 정보이고 급여·주민번호 같은
-- 민감 축이 없다. 메뉴 노출과 쓰기 권한은 앱 게이트(canWriteTenant "shuttle")가 담당한다.
-- ⚠️ 정책을 하나도 안 만들면 RLS는 **에러 없이 0행**을 돌려준다([[#104]]) — 아래 6개를 다 만들 것.
alter table public.shuttle_stops enable row level security;
alter table public.shuttle_vehicles enable row level security;
alter table public.shuttle_runs enable row level security;
alter table public.shuttle_run_stops enable row level security;
alter table public.shuttle_riders enable row level security;
alter table public.shuttle_boardings enable row level security;

drop policy if exists shuttle_stops_tenant_read on public.shuttle_stops;
create policy shuttle_stops_tenant_read on public.shuttle_stops
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists shuttle_vehicles_tenant_read on public.shuttle_vehicles;
create policy shuttle_vehicles_tenant_read on public.shuttle_vehicles
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists shuttle_runs_tenant_read on public.shuttle_runs;
create policy shuttle_runs_tenant_read on public.shuttle_runs
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists shuttle_run_stops_tenant_read on public.shuttle_run_stops;
create policy shuttle_run_stops_tenant_read on public.shuttle_run_stops
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists shuttle_riders_tenant_read on public.shuttle_riders;
create policy shuttle_riders_tenant_read on public.shuttle_riders
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists shuttle_boardings_tenant_read on public.shuttle_boardings;
create policy shuttle_boardings_tenant_read on public.shuttle_boardings
  for select using (tenant_id = public.auth_tenant_id());

-- updated_at 트리거(기존 공용 함수).
drop trigger if exists shuttle_stops_set_updated_at on public.shuttle_stops;
create trigger shuttle_stops_set_updated_at before update on public.shuttle_stops
  for each row execute function public.tg_set_updated_at();

drop trigger if exists shuttle_vehicles_set_updated_at on public.shuttle_vehicles;
create trigger shuttle_vehicles_set_updated_at before update on public.shuttle_vehicles
  for each row execute function public.tg_set_updated_at();

drop trigger if exists shuttle_runs_set_updated_at on public.shuttle_runs;
create trigger shuttle_runs_set_updated_at before update on public.shuttle_runs
  for each row execute function public.tg_set_updated_at();

drop trigger if exists shuttle_run_stops_set_updated_at on public.shuttle_run_stops;
create trigger shuttle_run_stops_set_updated_at before update on public.shuttle_run_stops
  for each row execute function public.tg_set_updated_at();

drop trigger if exists shuttle_riders_set_updated_at on public.shuttle_riders;
create trigger shuttle_riders_set_updated_at before update on public.shuttle_riders
  for each row execute function public.tg_set_updated_at();

drop trigger if exists shuttle_boardings_set_updated_at on public.shuttle_boardings;
create trigger shuttle_boardings_set_updated_at before update on public.shuttle_boardings
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
