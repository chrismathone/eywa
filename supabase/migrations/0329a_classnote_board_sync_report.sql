-- 0329a — ClassNote 반 보드 **동기화 보고서** + 해제 리스트 (원장 2026-10-02)
--   *"반 동기화 하고 그럼 우측에 '동기화 보고서 다운로드'가 나와야겠어. 이 동기화 보고서에는 모든 변동된 리스트가 남아있고,
--     변동실패한 리스트도 남아있고 모든 이유가 적혀있으면 될듯."* · *"감사로그 및 반이동 기록 등 모든 기록에도 남아있도록"* ·
--   *"반 보드 동기화시 해제해야할 리스트 txt로 다운로드할 수 있게"*
--
-- 반 보드 동기화(매일 새벽 5시 + '지금 반 보드 동기화')가 한 일은 지금까지 **연동 PC 로그 파일에만** 남았다. 무엇이 바뀌었고
-- 무엇이 왜 안 됐는지 앱에서 볼 길이 없어, 사람이 ClassNote 화면을 열어 하나씩 대조해야 했다.
--
--   ① classnote_board_sync_runs — 동기화 1회 = 1행. 그 회차의 변동·실패·보류를 **이유와 함께** 줄 단위로 담는다(events).
--   ② classnote_class_boards.release_names — 반 보드마다 "보드엔 있는데 aywa 그 반 명단엔 없는 원아"(해제 대상).
--      동기화가 볼 때마다 그 반의 목록을 통째로 갈아 끼운다. '지금 동기화'는 바뀐 반만 보므로, 전 반의 최신 목록은 여기서 읽는다.
--
-- 쓰기 = 연동 PC 워커(service_role 직결)만. 🔴 앱·워커는 이 SQL 전에도 돈다(#95) — 표·칸이 없으면 워커는 그 기록만 건너뛰고
-- (동기화는 그대로), 앱은 '동기화 보고서 다운로드' 버튼을 그리지 않는다.

-- ── ① 동기화 회차 ─────────────────────────────────────────────────────────
create table if not exists public.classnote_board_sync_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('daily', 'request')),      -- 매일 정기 동기화 / '지금 반 보드 동기화' 요청
  request_id uuid references public.classnote_sync_requests(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  ok boolean not null,                -- false = 도중에 멈췄다(error에 한글 사유). 그 전에 한 일은 events에 남는다
  error text,
  summary jsonb not null default '{}'::jsonb,   -- 숫자 요약(반·새 반·이름 변경·배정·담임·보류·해제 필요)
  -- 줄 목록 — [{ "group": "changed"|"failed"|"held"|"release", "className": "...", "text": "한글 한 줄(이유 포함)" }]
  -- 🔴 보호자 전화 **값**은 넣지 않는다(일치 여부만 — class-board-plan.mjs 사유와 같은 규약).
  events jsonb not null default '[]'::jsonb
);
create index if not exists classnote_board_sync_runs_recent_idx
  on public.classnote_board_sync_runs (tenant_id, finished_at desc);

-- 🔴 정책을 두지 않는다 = 사용자 클라이언트로는 0행([[#104]]). 줄마다 전 반의 학생·원아 이름과 보류 사유가 있어
--    서버 액션(보고서 쓰기 권한 확인 뒤 admin)만 읽는다. 강사가 PostgREST로 직접 긁지 못한다([[#92]]).
alter table public.classnote_board_sync_runs enable row level security;

comment on table public.classnote_board_sync_runs is
  'ClassNote 반 보드 동기화 회차(0329a) — 변동·실패·보류를 이유와 함께 담는다. 쓰기 = 연동 PC 워커, 읽기 = 서버 액션(정책 없음 = 사용자 직접 조회 불가).';

-- ── ② 반 보드별 해제 대상 ──────────────────────────────────────────────────
-- ⚠️ 의도적으로 이 표(테넌트 멤버 읽기, 0302a)에 얹는다([[#92]] — 안 적으면 닫힌 것으로 오인된다): 같은 계열
--    classnote_class_board_members.child_name(그 반의 원아 이름)이 이미 같은 범위로 읽힌다. 늘어나는 것은 '그 반 명단 밖 원아 이름'이고,
--    그 반 보류 학생과 이름이 겹치는 원아에는 이름 뒤에 '확인 필요 — 이 반 보류 학생 ○○○의 원아일 수 있음' 표시가 붙는다
--    (보류 여부·사유는 classnote_class_board_members가 이미 같은 범위로 보여 준다 — 새로 드러나는 사실은 없다).
--    회차별 변동·실패 줄은 위 회차 표에만 있고 서버만 읽는다. 앱의 보고서 내려받기는 보고서 쓰기 권한으로 따로 막는다.
alter table public.classnote_class_boards
  add column if not exists release_names jsonb,
  add column if not exists release_checked_at timestamptz;

comment on column public.classnote_class_boards.release_names is
  '이 반 보드에서 해제해야 할 ClassNote 원아 이름 배열(aywa 반 명단에 없는 원아 — 그 반 보류 학생과 이름이 겹치면 확인 필요 표시가 붙는다). 워커가 동기화 때마다 다시 적는다. 없으면 [].';
comment on column public.classnote_class_boards.release_checked_at is
  'release_names를 마지막으로 확인한 시각. null = 확인한 적 없음.';

notify pgrst, 'reload schema';
