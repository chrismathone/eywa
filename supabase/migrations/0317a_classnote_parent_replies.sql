-- 0317a — ClassNote **학부모 글·댓글에 답글**(aywa에서 쓰고 연동 PC 워커가 ClassNote 댓글로 게시) (2026-09-30).
--
-- 원장 2026-09-30 *"이전 1인 반에서 작동하는 기능을 반 기준으로 바꿔도 작동하게"* — 1인 보드 시절엔 그 보드에 연결된
-- 강사가 ClassNote 앱에서 직접 답글을 달았다. 반 보드로 옮기면 보드엔 담임 한 명만 연결돼 나머지 강사는 답할 자리가 없다.
-- 그래서 aywa(학부모 글 벨·수업보고서 '학부모 글' 면)에서 쓰고, 연동 PC 워커가 봇 계정으로 그 글에 **댓글**로 올린다.
--
-- 🔴 게시 명의 = `<반 이름> <강사 호칭>`(예 "BS3Q 수진T") — ClassNote `author_name`. 본문엔 서명을 넣지 않는다(원장 결정).
-- 🔴 쓰기 = 서버 액션(service_role)·워커(직결)만 — 사용자 쓰기 정책을 두지 않는다(0304a·0313a와 같은 규약). 요청은 서버가
--    메시지 행(0184a)으로 글·원아·보드를 **다시 찾아** 적는다(화면이 보낸 글 번호를 믿지 않는다).
-- 🔴 ClassNote 댓글은 되돌리기 어렵다(학부모에게 알림이 이미 간다) — 중복 게시 방어가 두 겹이다:
--    ① 같은 요청의 재클릭 = `client_key` 유니크 ② 같은 글·같은 본문이 대기·게시 중·게시됨이면 또 못 넣는다(부분 유니크).
--    ⚠️ 부분 유니크는 `ON CONFLICT` 타깃이 안 된다([[#113]]) — 앱은 **그냥 insert**하고 23505를 "이미 요청됨"으로 받는다.
--    워커는 게시 직전 그 글의 댓글을 다시 읽어 같은 본문의 봇 댓글이 있으면 올리지 않고 성공으로 적는다(세 번째 겹).
-- 🔴 수정·삭제도 워커 경유(edit_requested/delete_requested) — 원본은 `edit_history`에 남긴다(지우지 않는다).
-- 앱은 이 SQL 전에도 죽지 않는다([[#95]]) — 표가 없으면 '답글 쓰기' 버튼을 그리지 않는다. 옛 워커는 이 표를 모른다
-- (하트비트 `caps.parentReply`가 없으면 앱이 요청을 받지 않는다 — 아무도 안 집는 '대기 중' 방지).

create table if not exists public.classnote_parent_replies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- 무엇에 답하나 — 서버가 0184a 메시지 행에서 옮겨 적는다. 메시지 행이 지워져도 답글 기록은 남는다.
  message_id uuid references public.classnote_parent_messages(id) on delete set null,
  classnote_post_id bigint not null,                 -- 댓글을 달 글(학부모 새 글이면 그 글, 학부모 댓글이면 그 댓글이 달린 글)
  reply_to_comment_id bigint,                        -- 학부모 댓글에 답한 경우 그 댓글(표시용 — ClassNote엔 대댓글 구조가 없다)
  board_id bigint,                                   -- 워커가 글을 다시 읽어 확인한 보드 번호(요청 때 모르면 비어 있다)
  board_name text,                                   -- 요청 때 보드 이름(표시용 — 판정 근거로 쓰지 않는다)
  child_id bigint,                                   -- 그 글의 원아(워커가 글을 다시 읽어 대조한다)
  student_id uuid references public.students(id) on delete set null,

  -- 누가 · 무엇을
  author_user_id uuid references public.users(id) on delete set null,
  author_label text not null check (char_length(author_label) between 1 and 60),  -- ClassNote에 보일 이름("BS3Q 수진T")
  body text not null check (char_length(body) between 1 and 1000),
  client_key text not null check (char_length(client_key) between 8 and 80),     -- 화면이 한 번 누를 때 만든 키(재클릭 방어)

  -- 상태 — queued → processing → success | failed / success → edit_requested|delete_requested → processing → success|deleted
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'success', 'failed', 'edit_requested', 'delete_requested', 'deleted')),
  processing_action text check (processing_action in ('post', 'edit', 'delete')),  -- processing 중 무엇을 하는가(멈춤 복구가 되돌릴 자리)
  pending_body text check (pending_body is null or char_length(pending_body) between 1 and 1000),  -- 수정 요청 본문
  edit_history jsonb not null default '[]'::jsonb,   -- [{body, replaced_at, by}] — 수정 전 원문 보존
  last_action_by uuid references public.users(id) on delete set null,  -- 마지막으로 수정·삭제를 요청한 사람

  classnote_comment_id bigint,                       -- 게시된 ClassNote 댓글 번호
  error text,                                        -- 한글 사유(화면 표시)
  error_raw text,                                    -- 원문(툴팁) — 화면에 그대로 내보내지 않는다
  failed_action text check (failed_action in ('post', 'edit', 'delete')),  -- 마지막 실패가 어떤 요청이었나
  retry_count integer not null default 0,
  processing_at timestamptz,
  worker_host text,

  posted_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ① 재클릭 방어 — 한 번 누른 요청은 한 행.
create unique index if not exists classnote_parent_replies_client_key_uniq
  on public.classnote_parent_replies (tenant_id, client_key);

-- ② 같은 글·같은 본문 — 대기·게시 중·게시됨(수정·삭제 대기 포함)이면 또 못 넣는다. 실패·삭제된 것은 다시 쓸 수 있다.
create unique index if not exists classnote_parent_replies_same_body_uniq
  on public.classnote_parent_replies (tenant_id, classnote_post_id, md5(body))
  where status in ('queued', 'processing', 'success', 'edit_requested', 'delete_requested');

-- 워커 집기 — 할 일이 있는 행만.
create index if not exists classnote_parent_replies_work_idx
  on public.classnote_parent_replies (tenant_id, updated_at)
  where status in ('queued', 'processing', 'edit_requested', 'delete_requested');

create index if not exists classnote_parent_replies_message_idx
  on public.classnote_parent_replies (tenant_id, message_id);
create index if not exists classnote_parent_replies_recent_idx
  on public.classnote_parent_replies (tenant_id, created_at desc);

alter table public.classnote_parent_replies enable row level security;

-- 읽기 = 테넌트 멤버(답글 상태 표시). 쓰기 정책 없음 = service_role만([[#104]] — 정책 0개면 사용자 읽기도 0행이라 읽기는 연다).
drop policy if exists classnote_parent_replies_tenant_read on public.classnote_parent_replies;
create policy classnote_parent_replies_tenant_read on public.classnote_parent_replies
  for select using (tenant_id = auth_tenant_id());

-- 학생 계정은 못 읽는다(학부모 대화 내용) — 0184a·0313a와 같은 restrictive 게이트. `(select …)`로 감싸 행마다 부르지 않는다([[#91]]).
drop policy if exists classnote_parent_replies_role_gate on public.classnote_parent_replies;
create policy classnote_parent_replies_role_gate on public.classnote_parent_replies
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');

comment on table public.classnote_parent_replies is
  'ClassNote 학부모 글·댓글에 aywa에서 쓴 답글(0317a). 연동 PC 워커가 봇 계정으로 댓글 게시·수정·삭제. 쓰기 = 서버 액션·워커만.';

notify pgrst, 'reload schema';
