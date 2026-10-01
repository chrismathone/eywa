-- 0325a — 숙제 영상 **제출 링크**(학부모가 로그인 없이 aywa 링크로 영상을 올린다) (2026-10-01).
--
-- 원장 2026-10-01 *"가장 베스트네"* — ClassNote에 올리기 힘든 숙제 영상을 aywa 제출 링크(`/v/<토큰>`)로 바로 올린다.
-- 영상은 그 반 담임의 Drive 폴더(워커 자동 업로드와 같은 폴더·같은 이름 규칙)로 가고, `student_homework_videos`에
-- 출처 'link'로 한 줄 생긴다(학생 상세 '숙제 영상' 탭·영상 제출 현황 자동 집계가 그대로 잡는다 — 0324a 출처 칸 필요).
-- 원장 같은 날 *"링크는 일주일 후에 소멸"* — 링크는 7일(보고서에 붙는 링크 = 보고서일 + 7일째 당일까지, 학생 상세에서 복사한 링크 = 만든 날 + 7일).
--
-- ① homework_video_links — 학생 × 반 링크. 🔴 **토큰 원문은 저장하지 않는다**(sha256 해시만): DB가 새어도 링크를 되살릴 수 없게.
--    origin = manual(학생 상세 '제출 링크 복사') · report(수업보고서 글에 붙은 줄 — report_id로 추적).
--    report_share_hash = 링크를 만들 때 그 보고서 공유 토큰의 sha256 — 보고서를 열람 차단·ClassNote 회수·재발급하면
--    (공유 토큰이 바뀌거나 상태가 회수로 가면) 그 보고서 글에 붙었던 제출 링크도 함께 못 쓰게 된다(잘못 보낸 집이 7일 동안 올리지 못하게).
--    끊기(revoked_at)는 그 학생 × 반의 쓰는 중인 링크를 전부 닫는다(보고서에 붙은 것 포함).
-- ② homework_video_link_uploads — 올리기 한 번(업로드 세션) 기록. 남용 감시(시간당·하루 횟수 제한)와 완료 확인에 쓴다.
--    Drive 파일 번호는 **서버가 미리 받은 값**이다 — 완료 확인은 이 번호로 Drive를 다시 읽어 폴더·크기를 대조한 뒤에만
--    영상 줄을 만든다(브라우저가 보낸 값은 믿지 않는다). 업로드 세션 주소(capability URL)는 저장하지 않는다.
--
-- 🔴 링크 표: 읽기 = 지점 멤버(학생 계정 제외) · 쓰기 = 서버(service_role)만 — 0317a·0319a와 같은 규약(사용자 쓰기 정책 없음).
-- 🔴 업로드 표: **서버 전용**(0315a 영상 표와 같다) — `route`에 학생 이름·학교·학년·반이 있어 지점 전원에게 열면
--    "강사는 담당 학생만" 규칙을 PostgREST 직결로 우회한다. 앱은 이 표를 admin으로만 읽는다.
-- 🔴 앱은 이 SQL 전에도 돈다([[#95]]) — 표가 없으면 제출 링크 기능 전체가 없는 것처럼 숨는다(버튼 없음·보고서 줄 없음·링크 화면은
--    "지금은 제출을 받을 수 없습니다"). 0324a(출처 칸)도 함께 있어야 켜진다.
-- 되돌리기: 별도 요청(이 파일에 되돌리기 SQL을 두지 않는다 — 표를 지우면 제출 기록이 사라진다).

begin;

create table if not exists public.homework_video_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('manual', 'report')),
  report_id uuid references public.lesson_reports(id) on delete set null,
  report_share_hash text check (report_share_hash is null or report_share_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references public.users(id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
-- 이 파일의 옛 판을 먼저 돌린 DB에도 칸이 생기게(`create table if not exists`는 칸을 더하지 않는다).
alter table public.homework_video_links add column if not exists report_share_hash text
  check (report_share_hash is null or report_share_hash ~ '^[0-9a-f]{64}$');
create index if not exists homework_video_links_pair_idx
  on public.homework_video_links (tenant_id, student_id, class_id, created_at desc);
create index if not exists homework_video_links_report_idx
  on public.homework_video_links (tenant_id, report_id) where report_id is not null;

create table if not exists public.homework_video_link_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  link_id uuid not null references public.homework_video_links(id) on delete cascade,
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,}$'),
  drive_folder_id text not null,
  file_name text not null,
  bytes bigint not null check (bytes > 0),
  mime_type text not null,
  route jsonb not null,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  video_id uuid references public.student_homework_videos(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, drive_file_id)
);
create index if not exists homework_video_link_uploads_link_idx
  on public.homework_video_link_uploads (link_id, created_at desc);

alter table public.homework_video_links enable row level security;
alter table public.homework_video_link_uploads enable row level security;
revoke all on public.homework_video_links from anon;
revoke all on public.homework_video_link_uploads from anon, authenticated;
grant all on public.homework_video_links to service_role;
grant all on public.homework_video_link_uploads to service_role;

-- 읽기 = 테넌트 멤버. 쓰기 정책 없음 = service_role만([[#104]] — 정책 0개면 사용자 읽기도 0행이라 읽기는 연다).
drop policy if exists homework_video_links_tenant_read on public.homework_video_links;
create policy homework_video_links_tenant_read on public.homework_video_links
  for select using (tenant_id = auth_tenant_id());

-- 학생 계정은 못 읽는다 — 0317a·0319a와 같은 restrictive 게이트. `(select …)`로 감싸 행마다 부르지 않는다([[#91]]).
drop policy if exists homework_video_links_role_gate on public.homework_video_links;
create policy homework_video_links_role_gate on public.homework_video_links
  as restrictive for select to authenticated
  using ((select coalesce(public.auth_system_role(), '')) <> 'student');

comment on table public.homework_video_links is
  '숙제 영상 제출 링크(0325a) — 학생×반, 7일. 토큰 원문 없이 sha256만. origin manual=학생 상세 복사 · report=수업보고서 글. 쓰기 = 서버만.';
comment on table public.homework_video_link_uploads is
  '제출 링크 업로드 한 번(0325a). service_role 전용. Drive 파일 번호는 서버가 미리 받은 값 — 완료 확인은 이 번호로 Drive를 다시 읽어 대조한 뒤에만 영상 줄을 만든다.';

commit;

notify pgrst, 'reload schema';
