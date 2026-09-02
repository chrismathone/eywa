-- 0242a — 셔틀 운행 단위(그날 그 회차가 출발했나 / 끝났나)
--
-- 원장(2026-09-02): 최종 목표는 *"데스크 선생님들이 편하게 셔틀 탑승 위치 학생 배정하고, 동승하는
-- 선생님이 학생들이 해당 버스에 탔는지 안 탔는지 쉽게 체크하며, 그걸 관리자 … 추후 학부모까지
-- 위치같은것도 볼수있는"* 시스템. 편성(0225a)과 현장 체크(shuttle_boardings)는 이미 있고,
-- **관리자가 지금 상태를 보는 자리**가 비어 있었다. 그 자리에 필요한 게 이 표다.
--
-- 🔑 왜 boardings만으로는 안 되나 — `shuttle_boardings`는 "누가 탔나"만 안다. 그래서 아무 기록도
--    없는 회차가 **두 가지 뜻**을 갖는다: ① 아직 출발 전이라 당연히 비었다 ② 출발했는데 아무도
--    안 찍고 있다. 관제 화면에서 이 둘은 정반대의 신호인데(전자는 정상, 후자는 전화할 일) 지금은
--    구분할 수가 없다. 끝난 뒤도 마찬가지다 — 미기록 3명이 남은 채 종료된 회차는 "놓친 것"이지만
--    운행이 안 끝났는지 안 찍은 건지 알 길이 없다.
--
-- 🔴 **이건 법정 안전운행기록(도교법 §53⑦)이 아니다.** 좌석안전띠·동승보호자·전원하차 같은 점검
--    항목을 일부러 넣지 않았다(원장 2026-09-02: *"법정 기록 … 크게 필요없는거같은데"*). 나중에 그게
--    필요해지면 **이 표에 컬럼을 더한다** — 운행 단위는 그때도 같은 것이라 표를 새로 파지 말 것.
--
-- 🔴 **진행률(탑승 N/M)을 여기 저장하지 않는다.** 그 사실의 주인은 `shuttle_boardings`이고, 여기
--    한 벌 더 두면 찍을 때마다 두 곳을 맞춰야 한다(한쪽만 틀어지면 관제 숫자가 조용히 거짓이 된다).
--    화면은 boardings에서 세고, 이 표에서는 **출발/종료 시각만** 읽는다.
--
-- 🔴 **상태(status) 컬럼을 두지 않는다.** 'ready|running|done'은 started_at·ended_at에서 남김없이
--    도출되는데, 컬럼으로 두면 둘이 어긋난 행("종료됐는데 상태는 running")이 반드시 생긴다.
--    판정은 [`trip-state.ts`](src/features/shuttle/trip-state.ts) 순수 함수 하나가 한다.
--
-- 게이트는 **기록 축**(`canRecordBoarding` — 사무실 ∪ '셔틀 담당' ∪ super_admin)이다. 편성 축이
-- 아니다: 차에 타는 셔틀 선생님(실측 역할 `viewer`)이 출발을 찍는 사람이라, 편성 권한을 요구하면
-- 정작 쓸 사람이 못 쓴다(0225a·record-gate.ts와 같은 결).
--
-- 읽기 RLS = 테넌트 전원(0225a와 동일 — 운행 상태는 직원 공용 운영 정보다). 쓰기 정책 없음 =
-- 서버 액션(service_role) 전용.
--
-- 롤백:
--   drop table if exists public.shuttle_trips;
set local statement_timeout = '60s';

create table if not exists public.shuttle_trips (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ran_on date not null,
  -- 편성이 바뀌어도 지난 운행 기록은 읽혀야 한다 → 참조는 느슨하게(set null) 두고 **이름을 스냅샷**으로
  -- 함께 저장한다(shuttle_boardings와 같은 규약). 회차를 지워도 "그날 1호차 3회차가 돌았다"는 남는다.
  run_id uuid references public.shuttle_runs(id) on delete set null,
  vehicle_label text,
  run_no integer,

  -- 🔑 상태의 단일 소스. 둘 다 null = 출발 전 / started만 = 운행 중 / ended까지 = 종료.
  --    ⚠️ ended_at만 있고 started_at이 없는 행은 만들지 않는다(아래 check).
  started_at timestamptz,
  started_by uuid references public.users(id) on delete set null,
  ended_at timestamptz,
  ended_by uuid references public.users(id) on delete set null,
  constraint shuttle_trips_end_needs_start check (ended_at is null or started_at is not null),
  constraint shuttle_trips_end_after_start check (ended_at is null or ended_at >= started_at),

  -- 그 운행에 대한 한 줄 메모("차 막혀서 10분 지연") — 관제 화면이 그대로 보여준다.
  memo text constraint shuttle_trips_memo_len check (memo is null or char_length(memo) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shuttle_trips is
  '셔틀 운행 단위(0242a) — 그날 그 회차가 출발했나/끝났나. 진행률·상태는 저장하지 않는다(boardings에서 세고 시각에서 도출).';

-- 하루에 한 회차는 한 번 돈다. 앱이 이 축으로 upsert한다.
-- 🔴 **부분 인덱스(`where run_id is not null`)로 만들지 말 것** — Postgres는 부분 유니크 인덱스를
--    `ON CONFLICT (컬럼들)`로 추론하지 못해 upsert가 42P10으로 **전건 실패**한다([[#113]], 0225a에서
--    실증). 술어를 빼도 뜻은 같다: run_id가 null인 옛 행은 NULL끼리 충돌하지 않아 각자 남는다.
create unique index if not exists shuttle_trips_day_run_uniq
  on public.shuttle_trips (tenant_id, ran_on, run_id);
-- 관제·일별 화면(그날 전체)이 유일한 핫패스. 하루 회차는 실측 30개 규모라 이 인덱스면 충분하다.
create index if not exists shuttle_trips_tenant_day_idx
  on public.shuttle_trips (tenant_id, ran_on);

-- ── RLS — 읽기는 테넌트 전원, 쓰기는 서버 액션(service_role) 전용 (0225a와 동일) ────────
-- ⚠️ 정책을 하나도 안 만들면 RLS는 **에러 없이 0행**을 돌려준다([[#104]]).
alter table public.shuttle_trips enable row level security;

drop policy if exists shuttle_trips_tenant_read on public.shuttle_trips;
create policy shuttle_trips_tenant_read on public.shuttle_trips
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists shuttle_trips_set_updated_at on public.shuttle_trips;
create trigger shuttle_trips_set_updated_at before update on public.shuttle_trips
  for each row execute function public.tg_set_updated_at();

notify pgrst, 'reload schema';
