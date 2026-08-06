-- 0184a — 학부모 출결 연락(클래스노트)을 골라 모아 알린다 (2026-08-06).
--
-- 배경(원장 2026-08-06): *"셔틀 선생님이 일일이 담임선생님에게 확인받지 않고 모아볼 수 있게 하고 싶어"*
-- + *"오늘 결석한다, 언제부터 언제까지 결석한다. 일찍간다. 늦게 간다 같은 메시지를 잘 필터링해서 정리"*
-- + *"직원설정에서 '학생 출결 알림 (클래스노트) 받기' 토글 켜놓으면 그 계정에 모든 알림 가는걸로"*.
--
-- 지금 구조의 한계(2026-08-06 실측):
--  ① 학부모 출결 연락은 **담당 강사 벨에만** 꽂힌다 → 차량팀은 사람에게 물어보는 수밖에 없다.
--  ② 인바운드가 **수학 보드만** 본다(`BOARD_GROUPS.math`). 재원 341명 중 **영어만 다니는 학생이 149명(44%)**
--     이라, 이 상태로 명단을 만들면 절반이 빈 명단이 된다. 실제로 같은 날 `(영어)최연재` 보드에
--     "가족여행이 있어 연재 오늘 내일 수업에 못갈것같아요"가 올라왔지만 eywa는 그 글을 보지도 못했다.
--  ③ 출석부는 대안이 못 된다 — 최근 30일 결석 143건의 기록 시각 **중앙값이 수업일 19시 36분**,
--     오후 2시 이전 기록은 8%(12건)뿐. **셔틀이 출발할 때 출석부는 비어 있다.**
--
-- 이 마이그레이션이 여는 것 3가지:
--
-- 1. `users.attendance_alert_optin` — 직원 수정 폼의 '학생 출결 알림 (클래스노트) 받기' 토글.
--    켜면 **담당 반과 무관하게 전 학생**의 출결 연락 알림을 받는다(차량팀·사무실용). 기본 false
--    (아무도 안 켜면 지금과 동작이 100% 같다 = 무해한 배포).
--
-- 2. `students.classnote_child_id` — ClassNote **원아 ID**. 이게 이번 설계의 핵심이다.
--    지금 매핑은 **보드명**(`(수학)홍길동`)이라 1인 보드에서만 통하는데, 영어는 그룹반이라 보드명으로
--    학생을 특정할 수 없다. 반면 피드 행에는 `child`(원아 id)가 **그룹반 포함 100%** 실려 있다(실측 43/43).
--    원아 ↔ 학생 확정은 `admissioninfos`의 보호자 전화·원아명·생년 3겹으로 **474명 중 461명(97%)**,
--    최근 학부모 글 기준 **43건 전건(100%)**.
--    ⚠️ **전화는 대조에만 쓰고 저장하지 않는다** — 여기 남는 건 원아 id 하나뿐이다(개인정보 최소화).
--    ⚠️ 유니크는 (tenant, child_id) — 한 원아가 두 학생에 붙으면 남의 집 연락이 섞인다.
--
-- 3. `classnote_parent_messages` — 학부모 글·댓글 **원문 1행**(강사 수만큼 복제되는 notifications와 별개).
--    워커가 감지해 raw로 넣고, 앱이 AI로 출결 의도를 채운다. 왜 두 단계인가:
--      · 키워드로는 못 가른다(실측) — "오늘 연재 수업에 **못갈것** 같아요"는 '못가'와 글자가 안 겹쳐
--        정규식이 놓치고, 반대로 "보강 언제까지 하나요"·"늦게 확인했네요"는 오탐으로 잡힌다.
--      · AI 호출은 `generateJSON()` 단일 진입점을 거쳐야 하는데(CLAUDE.md) 그건 앱 코드다. 워커(연동 PC)에
--        API 키를 두지 않기 위해서도 분류는 앱이 한다.
--    ⚠️ `category`는 **제안**이다. 화면·알림은 항상 `content`(원문)를 함께 싣는다 — 오분류가 아이를
--       두고 가게 만들면 안 되므로 사람이 원문으로 최종 판단한다.
--
-- 옛 앱 호환(gotcha #95): 셋 다 **추가**뿐이라 옛 앱은 이 컬럼·표를 모른 채 그대로 돈다. 그래도 순서는
-- SQL 먼저 → 앱 배포다(새 앱이 이 컬럼들을 select 한다).

-- ── 1. 직원 토글 ──────────────────────────────────────────────────────────────
alter table users add column if not exists attendance_alert_optin boolean not null default false;

comment on column users.attendance_alert_optin is
  '학생 출결 알림(클래스노트) 받기. true면 담당 반과 무관하게 전 학생의 학부모 출결 연락 알림을 받는다(차량팀·사무실). 0184a.';

-- ── 2. ClassNote 원아 ID ─────────────────────────────────────────────────────
alter table students add column if not exists classnote_child_id bigint;

-- ⚠️ 이 컬럼은 **0185a에서 `classnote_child_links` 표로 대체·제거**된다 — 실데이터에서 같은 아이가
--    ClassNote 계정을 2개 갖는 경우가 16쌍 32명 나왔고(수학·영어 따로 가입), 단일 컬럼으로는 담기지 않는다.
comment on column students.classnote_child_id is
  'ClassNote 원아(child) ID. 피드 행의 child로 학생을 특정하는 결정적 키 — 보드명 매칭과 달리 그룹반(영어)에서도 통한다. 보호자 전화·원아명·생년 3겹 대조로 채우되 전화값은 저장하지 않는다. 0184a.';

-- ⚠️ 한 원아가 두 학생에 붙으면 남의 집 연락이 섞인다 → 테넌트 안에서 유일.
create unique index if not exists students_classnote_child_id_idx
  on students (tenant_id, classnote_child_id)
  where classnote_child_id is not null;

-- ── 3. 학부모 메시지 원문 + 출결 분류 ────────────────────────────────────────
create table if not exists classnote_parent_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,

  -- 출처(멱등 키)
  source text not null,                              -- post | comment
  classnote_post_id bigint not null,                 -- 글 id(댓글도 달린 글의 id를 함께 들고 있다 = 링크 대상)
  classnote_comment_id bigint,                       -- 댓글일 때만
  child_id bigint,                                   -- ClassNote 원아 id(매핑 실패해도 남긴다 = 나중에 복구 가능)
  student_id uuid references students(id) on delete set null,
  class_name text,                                   -- 보드명(사람이 읽는 단서. 판정 근거로는 쓰지 않는다)
  content text not null,
  posted_at timestamptz,

  -- 분류(앱이 채운다. classified_at is null = 아직 안 본 것)
  classified_at timestamptz,
  category text,                                     -- absence | late | early_leave | none
  starts_on date,                                    -- 결석/조퇴/지각이 시작되는 날
  ends_on date,                                      -- 기간 결석의 마지막 날(하루면 starts_on과 같다)
  detail text,                                       -- 한 줄 요약(사유·시각 등, 원문에 있는 말만)
  model text,                                        -- 어떤 모델이 분류했나(친화 라벨은 화면에서)
  classify_error text,

  notified_at timestamptz,                           -- 알림을 만든 시각(중복 발송 방지)
  created_at timestamptz not null default now()
);

-- 멱등 — 같은 글/댓글을 두 번 넣지 않는다. 댓글 없는 행(글)은 0으로 접어 유니크가 성립하게.
create unique index if not exists classnote_parent_messages_src_idx
  on classnote_parent_messages (tenant_id, source, classnote_post_id, coalesce(classnote_comment_id, 0));

-- 미분류 큐 — 앱이 매번 여는 조회라 부분 인덱스로 좁힌다.
create index if not exists classnote_parent_messages_unclassified_idx
  on classnote_parent_messages (tenant_id, created_at)
  where classified_at is null;

-- 화면(오늘의 출결 연락) — 날짜 역순.
create index if not exists classnote_parent_messages_posted_idx
  on classnote_parent_messages (tenant_id, posted_at desc);

comment on table classnote_parent_messages is
  '클래스노트 학부모 글·댓글 원문 1행 + 출결 의도 분류(0184a). category는 AI 제안이며 원문(content)이 항상 함께 표시된다.';

alter table classnote_parent_messages enable row level security;

drop policy if exists classnote_parent_messages_tenant_isolation on classnote_parent_messages;
create policy classnote_parent_messages_tenant_isolation on classnote_parent_messages
  for all
  using (tenant_id = public.auth_tenant_id())
  with check (tenant_id = public.auth_tenant_id());

-- ⚠️ 역할 게이트 = **학생 계정만 차단**(gotcha #92의 "의도적 제외는 반드시 적어라"에 따른 명시).
--    직원 전체(원장·관리자·강사·차량팀 viewer)는 읽을 수 있어야 한다 — 이 기능의 목적이 "담임에게
--    묻지 않고 모아 보는 것"이라 강사·차량팀을 막으면 기능 자체가 성립하지 않는다.
--    메뉴 게이트(`auth_menu_access('attendance')`)를 쓰지 **않은** 이유: 그 함수의 SQL DEFAULTS에
--    'attendance'가 없어서 지금 걸면 master 빼고 전원 'none' = 락아웃이다(#92의 실제 사고 조건).
--    나중에 DEFAULTS에 attendance를 넣을 때 이 정책을 메뉴 게이트로 승격할 것.
drop policy if exists classnote_parent_messages_role_gate on classnote_parent_messages;
create policy classnote_parent_messages_role_gate on classnote_parent_messages
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');
