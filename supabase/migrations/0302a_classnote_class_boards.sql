-- 0302a — 수학 반 보드 연결 기록 (2026-09-29, 원장 지시 "반별 학생 배정 발송 · C.N 라벨").
--
-- 왜: 수학 발송을 `(수학)학생명` 1인 보드에서 aywa 반과 이름이 같은 ClassNote 반 보드로 옮긴다(1인 보드는 유지).
--     반 보드 안에서는 **원아를 이름으로 고르면 안 된다**(같은 반 동명이인 — 원장이 가장 크리티컬하다고 한 경로).
--     그래서 "이 반 = 이 보드", "이 학생 = 이 원아"를 가드(1인 보드 원아 · 보호자 전화 · 생년 · 역방향 유일성 ·
--     같은 반 동명이인 · 이름 연속성 — scripts/_classnote/class-board-plan.mjs)를 통과한 결과로 **저장**하고,
--     발송 워커와 원스크린 'C.N' 라벨이 이 표만 읽는다.
--   · 쓰기 = 연동 PC 워커·스크립트(service_role)만. 앱 사용자 쓰기 정책을 두지 않는다(0145a의 교훈 —
--     사용자가 직접 넣은 연결이 "안전한 타깃"으로 승격되면 오발송이다).
--   · 보류(hold)도 저장한다 — 원스크린 빨간 C.N이 **이유**를 보여야 하기 때문이다.
--   · 🔴 0145a `classnote_student_links`를 쓰지 않는 이유: PK가 (학생, 보드)라 학부모·학생 두 계정을 못 담는다.
-- 앱은 이 SQL 전에도 죽지 않는다([[#95]]) — 표가 없으면 C.N 라벨을 안 그리고, 발송은 기존 1인 보드로 간다.

-- ── 반 ↔ ClassNote 반 보드 ─────────────────────────────────────────────────
create table if not exists public.classnote_class_boards (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  board_id bigint not null,          -- ClassNote 반 id
  board_name text not null,          -- 연결 당시 보드 이름(aywa 반 이름과 글자까지 같아야 한다 — 다르면 동기화가 알린다)
  synced_at timestamptz not null default now(),
  primary key (tenant_id, class_id)
);
-- 한 보드는 한 반에만 — 두 반이 한 보드를 가리키면 남의 반 학부모에게 간다.
create unique index if not exists classnote_class_boards_board_uniq
  on public.classnote_class_boards (tenant_id, board_id);

-- ── 반 보드의 학생 ↔ 원아 (판정 결과) ─────────────────────────────────────
create table if not exists public.classnote_class_board_members (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  board_id bigint not null,
  student_id uuid not null references public.students(id) on delete cascade,
  child_id bigint,                   -- 보류는 원아가 없을 수 있다(미가입 등)
  child_name text,                   -- 학부모가 등록한 원아 이름(표시용)
  status text not null check (status in ('ok', 'hold')),
  reason text,                       -- 보류 사유(한글). 🔴 보호자 전화 **값**은 절대 넣지 않는다(일치 여부만)
  checked_at timestamptz not null default now()
);
create index if not exists classnote_class_board_members_class_idx
  on public.classnote_class_board_members (tenant_id, class_id);
create index if not exists classnote_class_board_members_student_idx
  on public.classnote_class_board_members (tenant_id, student_id);
-- 🔴 한 보드의 한 원아는 **한 학생에게만**(ok 기준) — 스크립트가 실수해도 DB가 막는다.
--    (이 표는 반 단위로 지우고 다시 넣는다 — upsert를 쓰지 않으므로 부분 유니크여도 된다, [[#113]].)
create unique index if not exists classnote_class_board_members_child_uniq
  on public.classnote_class_board_members (tenant_id, board_id, child_id) where status = 'ok';

alter table public.classnote_class_boards enable row level security;
alter table public.classnote_class_board_members enable row level security;

-- 읽기 = 테넌트 멤버(원스크린 C.N 라벨·보고서 설정). 정책이 없으면 에러 없이 0행이다([[#104]]).
drop policy if exists classnote_class_boards_tenant_read on public.classnote_class_boards;
create policy classnote_class_boards_tenant_read on public.classnote_class_boards
  for select using (tenant_id = auth_tenant_id());
drop policy if exists classnote_class_board_members_tenant_read on public.classnote_class_board_members;
create policy classnote_class_board_members_tenant_read on public.classnote_class_board_members
  for select using (tenant_id = auth_tenant_id());

comment on table public.classnote_class_boards is
  'aywa 반 ↔ ClassNote 반 보드(수학). 워커만 쓴다. 발송·C.N 라벨의 단일 소스.';
comment on table public.classnote_class_board_members is
  '반 보드의 학생 ↔ 원아 판정 결과(ok/hold + 사유). 워커만 쓴다. 보호자 전화 값 저장 금지.';

notify pgrst, 'reload schema';
