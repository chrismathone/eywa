-- 0319a — ClassNote **학부모 글·댓글에 공감**(aywa에서 누르고 연동 PC 워커가 ClassNote 공감으로 반영) (2026-10-01).
--
-- 원장 2026-10-01 *"댓글 공감 누르기 버튼도 가능하면 기능 배선"* — 답글(0317a)과 같은 길이다: aywa(벨·수업보고서 '학부모 글·답글' 면)에서
-- 누르면 요청 행이 생기고, 연동 PC 워커가 봇 계정으로 그 글(학부모 새 글) 또는 그 댓글(학부모 댓글)에 공감을 누르거나 푼다.
-- 모드·자격·가드·쓰기 허가증은 답글과 **같은 것**을 쓴다(학원 설정 `report.classnoteParentReplyMode` — 끔·시험·전체).
--
-- 조사로 확정된 사실(2026-10-01, 학원이 테스트 글에서 실측):
--   · 글 `POST /api/v1_2/reports/{글}/reactions/` · 댓글 `POST /api/v1/reports/{글}/comments/{댓글}/reactions/` — 본문 `{reaction_type, author_name}`.
--   · 풀기 `DELETE …/reactions/{공감 번호}/`. 종류 6개: like(좋아요)·thanks(감사해요)·check(확인했어요)·delight(기쁨)·surprise(놀람)·sorrow(슬픔).
--   · ClassNote '공감한 사람' 목록에는 **보낸 명의(author_name)** 가 보인다(봇 계정 이름이 아니다).
--   · 공감은 **(계정·명의·종류)당 하나** — 같은 명의·같은 종류를 다시 보내면 같은 번호가 돌아온다(멱등). 명의가 다르면 봇 하나여도 새 공감이 생긴다.
--
-- 🔴 **학부모 메시지 하나에 공감 하나**(지점 단위) — 강사 여럿이 각자 누르면 학부모 폰에 공감 알림이 여러 번 간다. 먼저 누른 사람의
--    명의로 하나만 두고, 다른 사람에겐 "이미 공감함"으로 보인다. 풀었다가 다시 누르면 **같은 행을 다시 쓴다**(행을 새로 만들지 않는다).
--    그래서 유니크는 부분 인덱스가 아니라 **일반 유니크**다([[#113]] — 부분 유니크는 `ON CONFLICT` 타깃이 안 된다. 앱은 그냥 insert하고 23505를 받는다).
-- 🔴 쓰기 = 서버 액션(service_role)·워커(직결)만 — 사용자 쓰기 정책을 두지 않는다(0317a와 같은 규약).
-- 앱은 이 SQL 전에도 죽지 않는다([[#95]]) — 표가 없으면 공감 버튼을 그리지 않는다. 옛 워커는 이 표를 모른다
-- (하트비트 `caps.parentReaction`이 없으면 앱이 요청을 받지 않는다 — 아무도 안 집는 '대기 중' 방지).

create table if not exists public.classnote_parent_reactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- 무엇에 공감하나 — 서버가 0184a 메시지 행에서 옮겨 적는다(화면이 보낸 글 번호를 믿지 않는다).
  message_id uuid not null references public.classnote_parent_messages(id) on delete cascade,
  classnote_post_id bigint not null,                 -- 그 글(학부모 댓글이면 그 댓글이 달린 글)
  target_comment_id bigint,                          -- 학부모 댓글에 공감하는 경우 그 댓글. 비어 있으면 글에 공감
  board_id bigint,                                   -- 워커가 글을 다시 읽어 확인한 보드 번호(요청 때 모르면 비어 있다)
  board_name text,                                   -- 요청 때 보드 이름(표시용 — 판정 근거로 쓰지 않는다)
  child_id bigint,                                   -- 그 글의 원아(워커가 글을 다시 읽어 대조한다)
  student_id uuid references public.students(id) on delete set null,

  -- 누가 · 무엇을
  reaction_type text not null check (reaction_type in ('like', 'thanks', 'check', 'delight', 'surprise', 'sorrow')),
  author_user_id uuid references public.users(id) on delete set null,   -- 누른 사람
  author_label text not null check (char_length(author_label) between 1 and 60),  -- ClassNote '공감한 사람'에 보일 이름("BS3Q 수진T")
  last_action_by uuid references public.users(id) on delete set null,   -- 마지막으로 누르거나 푼 사람

  -- 상태 — queued → processing → success | failed / success → remove_requested → processing → removed | success
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'success', 'failed', 'remove_requested', 'removed')),
  processing_action text check (processing_action in ('add', 'remove')),   -- processing 중 무엇을 하는가(멈춤 복구가 되돌릴 자리)
  classnote_reaction_id bigint,                      -- ClassNote 공감 번호(풀 때 쓴다)
  error text,                                        -- 한글 사유(화면 표시)
  error_raw text,                                    -- 원문(툴팁) — 화면에 그대로 내보내지 않는다
  failed_action text check (failed_action in ('add', 'remove')),
  retry_count integer not null default 0,
  -- 누르기 요청을 **보냈는데 결과를 확정하지 못했다**(응답이 끊기고 다시 읽기도 실패) — ClassNote에 눌려 있을 수 있다.
  -- 이 표식이 선 행은 앱이 취소하거나 다른 명의·종류로 덮어쓰지 않는다(그 공감을 aywa가 잊으면 풀 길이 없다). 워커가 확정하면 내린다.
  unconfirmed boolean not null default false,
  processing_at timestamptz,
  worker_host text,

  requested_at timestamptz not null default now(),   -- 마지막으로 '누름'을 요청한 시각(행을 다시 쓰면 갱신 — 묵은 요청 판정)
  reacted_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 표가 이미 있는 DB(이 파일의 옛 판을 돌린 적이 있다면)에도 '확인 필요' 칸이 생기게 — `create table if not exists`는 칸을 더하지 않는다.
alter table public.classnote_parent_reactions add column if not exists unconfirmed boolean not null default false;

-- 학부모 메시지 하나에 공감 하나(지점 단위). 일반 유니크 — 풀었다 다시 누르면 같은 행을 다시 쓴다.
create unique index if not exists classnote_parent_reactions_message_uniq
  on public.classnote_parent_reactions (tenant_id, message_id);

-- 워커 집기 — 할 일이 있는 행만.
create index if not exists classnote_parent_reactions_work_idx
  on public.classnote_parent_reactions (tenant_id, updated_at)
  where status in ('queued', 'processing', 'remove_requested');

alter table public.classnote_parent_reactions enable row level security;

-- 읽기 = 테넌트 멤버(공감 상태 표시). 쓰기 정책 없음 = service_role만([[#104]] — 정책 0개면 사용자 읽기도 0행이라 읽기는 연다).
drop policy if exists classnote_parent_reactions_tenant_read on public.classnote_parent_reactions;
create policy classnote_parent_reactions_tenant_read on public.classnote_parent_reactions
  for select using (tenant_id = auth_tenant_id());

-- 학생 계정은 못 읽는다(학부모 대화에 딸린 기록) — 0184a·0317a와 같은 restrictive 게이트. `(select …)`로 감싸 행마다 부르지 않는다([[#91]]).
drop policy if exists classnote_parent_reactions_role_gate on public.classnote_parent_reactions;
create policy classnote_parent_reactions_role_gate on public.classnote_parent_reactions
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');

comment on table public.classnote_parent_reactions is
  'ClassNote 학부모 글·댓글에 aywa에서 누른 공감(0319a). 메시지당 하나. 연동 PC 워커가 봇 계정으로 누르고 푼다. 쓰기 = 서버 액션·워커만.';

notify pgrst, 'reload schema';
