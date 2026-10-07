-- 0354a — 학부모 '차량 출발' 알림 확인 표식 (사용자 2026-10-07, 푸시 가정)
--
-- 아직 진짜 앱(푸시)이 아니므로, 회차가 **출발**(0243a `shuttle_trips.started_at`)하면 그 회차에 타는 아이의
-- 학부모 화면 위쪽에 "차량이 출발했습니다" 한 줄을 띄우고, [확인]을 누르면 내린다.
--
-- 🔑 알림 자체는 저장하지 않는다 — "오늘 그 회차가 출발했나 + 우리 아이가 그 회차에 타나"에서 도출된다
--    (운행 상태를 컬럼으로 두지 않은 0243a와 같은 결: 출발 기록이 진실이고 알림은 그 그림자다).
--    여기엔 **학부모가 확인했다**는 사실만 쌓는다.
-- 🔑 확인은 **학부모 계정마다** 따로다(직원 공용인 0323a와 다르다) — 엄마가 확인해도 아빠 화면엔 남는다.
-- 🔑 쓰기는 service_role 전용(학부모 세션은 RLS로 아무 표도 못 읽는다 — parent-viewer.ts). 정책은 두지 않는다.
--
-- 되돌리기:
--   drop table if exists public.parent_departure_acks;

set local statement_timeout = '60s';

create table if not exists public.parent_departure_acks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  parent_account_id uuid not null references public.parent_accounts(id) on delete cascade,
  ran_on date not null,
  run_id uuid not null,
  acked_at timestamptz not null default now()
);

comment on table public.parent_departure_acks is
  '학부모 차량 출발 알림 확인 표식(0354a) — 확인한 (날짜·회차)는 그 학부모 화면에서 내린다.';

-- 🔴 부분 유니크(WHERE) 금지 — 이 축으로 upsert한다([[#113]]).
create unique index if not exists parent_departure_acks_uniq
  on public.parent_departure_acks (tenant_id, parent_account_id, ran_on, run_id);

alter table public.parent_departure_acks enable row level security;

notify pgrst, 'reload schema';
