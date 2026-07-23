-- 0142a: ClassNote **반 보드 구성** 스냅샷 — eywa 반 ↔ ClassNote 보드 불일치 상시 점검 (2026-07-23, 원장 지시).
--
-- 왜: 영어는 학생 1인 보드가 아니라 **반 보드**로 운영된다(`Jane 중1 정규A (화수금)`). 그래서
-- "eywa 반에 있는 학생이 ClassNote 반 보드에도 있는가"가 발송 성공의 전제인데, 지금은 아무도 안 본다.
-- 2026-07-23 1회 실측: 학생-반 248건 중 **30건(12%)이 보드에 없었다**(고2 심화·고3 정규는 반 전체가
-- 빈 보드). 반 이동·신입·퇴원 때마다 다시 벌어지므로 **한 번 고치고 끝나는 문제가 아니다** → 상시 점검.
--
-- 왜 저장해야 하나: ClassNote 조회엔 Playwright 세션이 필요하고 그 자격증명은 **연동 PC에만** 있다
-- (서버 컴포넌트가 브라우저를 못 띄운다). classnote_class_posts(0140a)와 같은 구조 —
-- **워커가 하루 1회 스냅샷 → 화면은 DB만 읽는다.**
--
-- ⚠️ 스냅샷 대상은 **반 보드만**(보드명이 `(수학)`·`(영어)`로 시작하지 않는 것). 1인 보드 526개는
--    provisioning/assign 스크립트가 이미 담당하고, 전건(654개)을 매일 훑으면 요청이 5배로 는다.
-- ⚠️ drizzle journal 밖(손수 alpha). 신규 DB는 pnpm db:alphas가 사전순 적용.

-- ── 보드 목록 ────────────────────────────────────────────────────────────────
-- PK에 board_id를 쓴다 — **같은 이름의 보드가 2개일 수 있고**(board-safety의 dup_board 경로),
-- 그 중복 자체가 점검이 잡아내야 할 문제다. 이름을 PK로 하면 그 사실이 upsert로 지워진다.
create table if not exists classnote_boards (
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id bigint not null,                -- ClassNote 반 id
  board_name text not null,                -- 원문(정규화 안 함 — 매칭 규칙이 바뀌어도 재계산 가능)
  child_count int,                         -- approved_children. ⚠️ 모르면 null(0으로 뭉개지 말 것 — 0="아무도 없음"이라는 사실)
  synced_at timestamptz not null default now(),
  primary key (tenant_id, board_id)
);

create index if not exists classnote_boards_tenant_name_idx on classnote_boards (tenant_id, board_name);

-- ── 보드별 원아 ──────────────────────────────────────────────────────────────
create table if not exists classnote_board_members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  board_id bigint not null,
  child_id bigint not null,                -- ClassNote 원아 id
  child_name text not null,                -- 학부모가 등록한 이름 — eywa 학생명과 다를 수 있다(그게 점검 대상)
  -- 생년만 저장한다(월·일 불필요). 용도는 **동명 후보가 같은 아이인지** 판별 하나뿐 —
  -- `Jay(이재희)`+`이재희`처럼 계정이 둘인 케이스를 오발송으로 오판하지 않기 위함.
  birth_year int,
  synced_at timestamptz not null default now(),
  primary key (tenant_id, board_id, child_id)
);

create index if not exists classnote_board_members_tenant_board_idx
  on classnote_board_members (tenant_id, board_id);

alter table classnote_boards enable row level security;
alter table classnote_board_members enable row level security;

-- 읽기 = 테넌트 멤버(점검 화면). 쓰기 = 워커(service_role)만 — insert/update 정책을 두지 않는다.
drop policy if exists classnote_boards_tenant_read on classnote_boards;
create policy classnote_boards_tenant_read on classnote_boards
  for select using (tenant_id = auth_tenant_id());

drop policy if exists classnote_board_members_tenant_read on classnote_board_members;
create policy classnote_board_members_tenant_read on classnote_board_members
  for select using (tenant_id = auth_tenant_id());

comment on table classnote_boards is
  'ClassNote 반 보드 스냅샷(반 구성 점검용). 워커가 하루 1회 적재 — 1인 보드((수학)·(영어) 접두)는 제외.';
comment on table classnote_board_members is
  'ClassNote 반 보드의 원아 스냅샷. eywa 반 로스터와 대조해 미배정·잉여·이중계정을 판정한다.';
