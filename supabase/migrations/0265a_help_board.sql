-- 0265a — 도움말 질문 게시판
--
-- 원장(2026-09-15): *"도움말에는 간단한 qna 정도만 넣어놓고 아니면 게시물 작성해서 답변 받아볼 수
-- 있게 게시판 형태 정도만"*. 화면별 설명은 F1 겹침이 맡고, /help 는 Q&A + 이 표만 둔다.
--
-- 🔑 구조:
--   ① 질문 `help_posts` · 답변 `help_answers`. 답변은 글에 여러 개(이어 다는 댓글).
--   ② 상태 open / answered / closed — 첫 답변이 달리면 answered. closed 는 작성자 또는 답변 자격이 닫는다.
--   ③ 읽기는 테넌트 격리(select 정책). 쓰기는 서버 액션(service_role) + 앱 게이트
--      (질문 = 도움말 메뉴 접근 · 자기 글만 수정·삭제 / 답변 = master·admin·super_admin).
--
-- 🔴 부분 유니크(WHERE) 금지([[#113]]).
-- 🔴 RLS 정책끼리 서로의 표를 조회하지 않는다([[#109]]).
-- 🔴 `auth_menu_access` 를 RLS 에 쓰지 말 것([[#92]]).
-- 🔴 정책을 하나도 안 만들면 세션 클라이언트로 에러 없이 0행이다([[#104]]).
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 Q&A 는 그대로, 게시판 자리에
--    한글 안내만 띄우고 쓰기는 잠근다.
--
-- 롤백:
--   drop table if exists public.help_answers;
--   drop table if exists public.help_posts;
set local statement_timeout = '60s';

create table if not exists public.help_posts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete restrict,
  title text not null constraint help_posts_title_len check (char_length(title) between 1 and 80),
  body text not null constraint help_posts_body_len check (char_length(body) between 1 and 4000),
  status text not null default 'open'
    constraint help_posts_status_chk check (status in ('open', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.help_posts is
  '도움말 질문 게시판(0265a). 테넌트 직원 질문. 화면 설명서는 F1 겹침이 담당한다.';

create index if not exists help_posts_tenant_created_idx
  on public.help_posts (tenant_id, created_at desc);

create table if not exists public.help_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid not null references public.help_posts(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete restrict,
  body text not null constraint help_answers_body_len check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.help_answers is
  '도움말 질문 답변(0265a). master·admin·super_admin 이 서버 액션으로 쓴다.';

create index if not exists help_answers_post_idx
  on public.help_answers (tenant_id, post_id, created_at);

alter table public.help_posts enable row level security;
alter table public.help_answers enable row level security;

drop policy if exists help_posts_tenant_read on public.help_posts;
create policy help_posts_tenant_read on public.help_posts
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists help_answers_tenant_read on public.help_answers;
create policy help_answers_tenant_read on public.help_answers
  for select using (tenant_id = public.auth_tenant_id());

drop trigger if exists help_posts_set_updated_at on public.help_posts;
create trigger help_posts_set_updated_at before update on public.help_posts
  for each row execute function public.tg_set_updated_at();

drop trigger if exists help_answers_set_updated_at on public.help_answers;
create trigger help_answers_set_updated_at before update on public.help_answers
  for each row execute function public.tg_set_updated_at();
