-- 0226a — 전자결재 문서 댓글 (하이웍스 개편 전자결재 매뉴얼의 '댓글' 대응, 원장 2026-08-19)
--
-- 원장: "결재 밑에 댓글처럼 있어서 전결 이유나 여러가지 공유하는거같음. 이것도 만들어줘."
-- 문서 아래에 참여자(기안자·결재선·참조·원장)가 짧은 글을 남겨 전결 사유·보충 설명을 공유한다.
-- 결재 판단(approval_steps.comment — 도장과 함께 남는 의견)과는 **다른 물건**이다: 그건 결재 1회에
-- 1개 붙는 처리 의견이고, 이건 문서에 몇 번이든 다는 대화형 코멘트다.
--
-- ⚠️ RLS 읽기 자격은 0213a의 security definer 함수(auth_can_read_approval_doc) 재사용 — 정책이
--    서로의 표를 직접 조회하면 무한 재귀 42P17로 표 전체가 안 읽힌다([[#109]]).
-- ⚠️ 쓰기는 서버 액션(service_role) 전용 — 0213a와 같은 규약(authenticated 쓰기 정책 없음).
--    참여자 판정(기안자·결재선·참조·원장)은 addApprovalComment가 서버에서 한다.
-- 롤백: drop table public.approval_comments;
set local statement_timeout = '60s';

create table if not exists public.approval_comments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.approval_documents(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  body text not null
    constraint approval_comments_body_len check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

comment on table public.approval_comments is
  '전자결재 문서 댓글(하이웍스 개편 전자결재 댓글 대응) — 참여자가 전결 사유 등 보충 내용을 공유. 결재 의견(approval_steps.comment)과 별개. 0226a';

create index if not exists approval_comments_document_idx
  on public.approval_comments (document_id, created_at);

alter table public.approval_comments enable row level security;

-- 읽기 = 문서를 볼 수 있는 사람(기안자·결재선·참조·원장) — 문서·결재선·참조와 같은 자격 함수.
drop policy if exists approval_comments_read on public.approval_comments;
create policy approval_comments_read on public.approval_comments
  for select
  using (tenant_id = public.auth_tenant_id() and public.auth_can_read_approval_doc(document_id));

notify pgrst, 'reload schema';
