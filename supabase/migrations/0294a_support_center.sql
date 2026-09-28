-- 0294a — 고객센터(공지사항 · 개선요청)
--
-- 원장(2026-09-28): *"https://school.makeedu.co.kr/board/csQnaList.do 를 참고해서 고객센터 메뉴를 도움말 아래에"*.
-- makeedu 고객센터의 두 면을 옮긴다 — **학원(지점) → aywa 운영자(슈퍼관리자)** 창구다.
--   · 도움말 게시판(0265a)과 방향이 다르다: 저건 **한 지점 안에서** 직원이 묻고 원장·관리자가 답한다.
--     여기는 지점이 묻고 **슈퍼관리자가 모든 지점을 모아** 답한다.
--
-- 🔑 구조:
--   ① `support_requests` = 개선요청. 지점 직원이 쓰고(제목·담당자 연락처·이메일·내용), 슈퍼관리자가
--      처리상태(접수 → 내용확인 → 처리중 → 완료)·처리완료 예정일·답변을 채운다. 답변은 글에 **하나**(makeedu와 같다).
--      읽기 = 테넌트 격리(같은 지점 글은 모두 본다 — makeedu도 지점 안 모든 직원의 요청이 한 목록이다).
--   ② `support_notices` = 공지사항. 슈퍼관리자가 쓰고 **전 지점**이 읽는다.
--      🔴 의도적 제외(#92): `tenant_id`가 없다 — 지점 데이터가 아니라 플랫폼 공지다. 읽기는 로그인 사용자 전원,
--      쓰기 정책은 없다(서버 액션이 service_role로만 쓴다 = 슈퍼관리자 게이트).
--   ③ 쓰기는 전부 서버 액션(service_role) + 앱 게이트
--      (요청 작성 = 고객센터 메뉴 접근 · 자기 글이고 '접수'일 때만 수정·삭제 / 답변·공지 = super_admin).
--
-- 🔴 부분 유니크(WHERE) 금지([[#113]]).
-- 🔴 RLS 정책끼리 서로의 표를 조회하지 않는다([[#109]]).
-- 🔴 `auth_menu_access` 를 RLS 에 쓰지 말 것([[#92]]).
--
-- ⚠️ 앱은 이 SQL 적용 전에도 죽지 않는다([[#95]]) — 표가 없으면 목록 자리에 한글 안내만 띄우고 쓰기는 잠근다.
--
-- 롤백(되돌릴 때만):
--   drop table if exists public.support_requests;
--   drop table if exists public.support_notices;
set local statement_timeout = '60s';

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete restrict,
  title text not null constraint support_requests_title_len check (char_length(title) between 1 and 120),
  body text not null constraint support_requests_body_len check (char_length(body) between 1 and 8000),
  contact_phone text constraint support_requests_phone_len check (contact_phone is null or char_length(contact_phone) <= 40),
  contact_email text constraint support_requests_email_len check (contact_email is null or char_length(contact_email) <= 200),
  status text not null default 'received'
    constraint support_requests_status_chk check (status in ('received', 'checking', 'in_progress', 'done')),
  due_date date,
  answer text constraint support_requests_answer_len check (answer is null or char_length(answer) <= 8000),
  -- 답한 슈퍼관리자(super_admins.id = auth uid). 지점 화면엔 이름 대신 'aywa'로 보인다.
  answered_by uuid,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_requests is
  '고객센터 개선요청(0294a). 지점 직원 → 슈퍼관리자. 처리상태·예정일·답변은 슈퍼관리자가 채운다.';

create index if not exists support_requests_tenant_created_idx
  on public.support_requests (tenant_id, created_at desc);
create index if not exists support_requests_created_idx
  on public.support_requests (created_at desc);

create table if not exists public.support_notices (
  id uuid primary key default gen_random_uuid(),
  title text not null constraint support_notices_title_len check (char_length(title) between 1 and 120),
  body text not null constraint support_notices_body_len check (char_length(body) between 1 and 20000),
  -- 목록 맨 위 [공지] 고정.
  pinned boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_notices is
  '고객센터 공지사항(0294a). 슈퍼관리자 → 전 지점. tenant_id 없음(플랫폼 공지, 의도적 제외).';

create index if not exists support_notices_list_idx
  on public.support_notices (pinned desc, created_at desc);

alter table public.support_requests enable row level security;
alter table public.support_notices enable row level security;

drop policy if exists support_requests_tenant_read on public.support_requests;
create policy support_requests_tenant_read on public.support_requests
  for select using (tenant_id = public.auth_tenant_id());

drop policy if exists support_notices_read on public.support_notices;
create policy support_notices_read on public.support_notices
  for select to authenticated using (true);

drop trigger if exists support_requests_set_updated_at on public.support_requests;
create trigger support_requests_set_updated_at before update on public.support_requests
  for each row execute function public.tg_set_updated_at();

drop trigger if exists support_notices_set_updated_at on public.support_notices;
create trigger support_notices_set_updated_at before update on public.support_notices
  for each row execute function public.tg_set_updated_at();
