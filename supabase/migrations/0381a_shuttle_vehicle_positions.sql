-- 0381a — 셔틀 차량 위치(기사 폰 GPS) (사용자 2026-10-15 "GPS 기능 추가")
--
-- 운행 중(0243a `shuttle_trips` 출발~종료) 기사 폰 브라우저가 `navigator.geolocation`으로 받은 좌표를
-- 몇 초마다 서버로 보내고, 학부모 '실시간 차량' · 관리자 '실시간 위치' 지도가 🚌 마커로 그린다.
--
-- 🔑 **회차마다 최신 한 줄만** 둔다(upsert) — 지금 필요한 건 "지금 어디쯤"이다. 지나온 자취(이력)는 아직 두지 않는다
--    (하루 회차 30개 × 10초 간격이면 이력은 금방 수만 행이 된다 — 필요해지면 따로 연다).
-- 🔑 그날·그 회차 축(`tenant_id, ran_on, run_id`)은 `shuttle_trips`와 같다. 운행이 끝나면 화면이 읽지 않는다
--    (종료 여부는 trips가 진실 — 위치 행을 지우지 않는다).
-- 🔑 쓰기는 서버 액션(service_role) 전용 — 운행 중인 회차에, 기록 권한(`canRecordBoarding`)이 있는 사람만.
--    읽기 RLS = 테넌트 직원(0243a와 같은 결). 학부모 세션은 RLS로 못 읽는다 — 서버가 **우리 아이 회차만** 골라 준다.
--
-- 되돌리기:
--   drop table if exists public.shuttle_vehicle_positions;

set local statement_timeout = '60s';

create table if not exists public.shuttle_vehicle_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ran_on date not null,
  run_id uuid not null references public.shuttle_runs(id) on delete cascade,
  lat double precision not null constraint shuttle_vehicle_positions_lat check (lat between -90 and 90),
  lng double precision not null constraint shuttle_vehicle_positions_lng check (lng between -180 and 180),
  -- 폰이 알려 준 오차(m) · 진행 방향(북=0°) · 속도(m/s). 폰이 모르면 null.
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  -- 폰에서 좌표를 잡은 시각(기기 시계) / 서버가 받은 시각 — 화면의 "N초 전"은 받은 시각 기준이다(기기 시계는 틀릴 수 있다).
  measured_at timestamptz,
  received_at timestamptz not null default now(),
  sent_by uuid references public.users(id) on delete set null
);

comment on table public.shuttle_vehicle_positions is
  '셔틀 차량 최신 위치(0381a) — 운행 중 기사 폰 GPS, 회차마다 한 줄(upsert).';

-- 🔴 부분 유니크(WHERE) 금지 — 이 축으로 upsert한다([[#113]]).
create unique index if not exists shuttle_vehicle_positions_day_run_uniq
  on public.shuttle_vehicle_positions (tenant_id, ran_on, run_id);

alter table public.shuttle_vehicle_positions enable row level security;

drop policy if exists shuttle_vehicle_positions_tenant_read on public.shuttle_vehicle_positions;
create policy shuttle_vehicle_positions_tenant_read on public.shuttle_vehicle_positions
  for select using (tenant_id = public.auth_tenant_id());

notify pgrst, 'reload schema';
