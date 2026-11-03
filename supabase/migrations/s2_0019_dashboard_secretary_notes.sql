-- s2_0018 — 업무 비서 'AI로 정리' 기록 · 마지막 후보 (2026-11-02)
--
-- 왜: 원장 *"확인할 일들을 스마트하게 보여주는건? … ai가 비서가되어줘서 알려주면 좋을듯"* — 대시보드 전환 화면 '확인할 일' 위의 업무 비서.
--     같은 날 원장 *"업무 비서를 새벽 1시에 한번, 오후 1시에 한번 이렇게 두번 돌려주고 … 언제 돌렸는지 시간도 남겨"* — 예약 실행과 시각.
--     결정 본문 = docs/decisions/dashboard.md '업무 비서'.
-- 🔴 AI는 사람이 'AI로 정리'를 누를 때와 예약 시각(01:00 · 13:00 KST)에만 부른다(페이지 로드는 부르지 않는다 — CLAUDE.md AI 정책).
--    비서의 숫자는 그 사람 화면이 계산한 값이라(사람 권한으로 도는 조회) 예약 실행은 다시 세지 않고, 화면이 남긴 마지막 후보
--    (`dashboard_secretary_inputs`)로 정리한다 — 정리에는 자료를 받은 시각(`basis_at`)을 함께 남겨 화면이 '숫자 기준'을 적는다.
-- 🔴 **새 표 둘만 더한다.** 기존 표·함수·트리거·알림은 건드리지 않는다(원장 *"기존 2.0은 아무 이상 없도록 별도로 적용"*).
-- 🔴 쓰기·읽기 = 서버만(service_role). 사용자 정책 0개 — 서버가 지점과 본인을 늘 함께 거른다(#104 · 본인의 정리만 본다).
-- 순서: 이 SQL을 먼저 적용한 뒤 앱을 배포한다(표가 없으면 'AI로 정리' 버튼이 없고 자동 정리만 보인다 — #95).

begin;

set local lock_timeout = '5s';

create table if not exists public.dashboard_secretary_notes (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- 정리를 받은 사람 — 본인만 본다.
  user_id uuid not null references public.users(id) on delete cascade,
  -- KST 날짜 — 화면은 오늘 것만 보인다.
  for_date date not null,
  -- 답한 모델 id(화면엔 친화적 라벨로만).
  model text,
  -- 정리할 때의 후보(ref · 제목 · 수 · 근거 줄) — 그 뒤 바뀐 숫자 비교 · 무엇을 근거로 썼는지.
  input jsonb not null,
  -- 후검증을 지난 정리 { plan: { headline, steps[], later[] }, replaced }.
  result jsonb not null,
  -- 누가 돌렸나 — 'button'(사람이 누름) · 'schedule'(예약 01:00 · 13:00).
  run_kind text not null default 'button' check (run_kind in ('button', 'schedule')),
  -- 후보를 받은 시각(= 숫자 기준). 버튼은 누른 때와 같다.
  basis_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dashboard_secretary_notes_input_size check (octet_length(input::text) <= 200000),
  constraint dashboard_secretary_notes_result_size check (octet_length(result::text) <= 60000)
);

create index if not exists dashboard_secretary_notes_owner_idx
  on public.dashboard_secretary_notes (tenant_id, user_id, for_date, created_at desc);

-- 사람마다 마지막 후보 하나 — 화면이 숫자가 바뀔 때 남긴다(AI 호출 없음). 예약 실행이 이 값으로 정리한다.
create table if not exists public.dashboard_secretary_inputs (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  input jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  constraint dashboard_secretary_inputs_size check (octet_length(input::text) <= 200000)
);

alter table public.dashboard_secretary_notes enable row level security;
alter table public.dashboard_secretary_inputs enable row level security;
revoke all on public.dashboard_secretary_notes, public.dashboard_secretary_inputs from public, anon, authenticated;
grant all on public.dashboard_secretary_notes, public.dashboard_secretary_inputs to service_role;

comment on table public.dashboard_secretary_notes is
  '업무 비서 AI 정리(s2_0018) — 사람이 누를 때 · 예약(01:00 · 13:00)에만 만든다 · 본인·그날 것만 보인다 · RLS 정책 0(서버만)';
comment on table public.dashboard_secretary_inputs is
  '업무 비서 마지막 후보(s2_0018) — 화면이 남기고 예약 정리가 읽는다 · 사람마다 한 줄 · RLS 정책 0(서버만)';

commit;
