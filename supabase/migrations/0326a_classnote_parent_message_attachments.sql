-- 0326a — 학부모 글·댓글의 **사진 주소** 보관 표 (2026-10-01).
--
-- 원장 2026-10-01 *"사진도 바로 볼 수 있게"* · *"클래스노트 사진의 주소가 있으니까 링크형식으로 따오면 되지 않을까나"* — 사진은 aywa에 **보관하지 않고**
-- ClassNote가 준 사진 주소를 그대로 쓴다(저장소·버킷 없음). 답글 창 쓰레드의 학부모 글·댓글 밑에 작은 사진 격자로 뜨고, 누르면 크게 열린다.
--
-- 실측(2026-10-01, 읽기 전용 GET): 피드 `attached_images[]` 항목 = { id, access_key, original_file_name, file_size, width, height,
--   original, large, small, small_resize, large_resize } — 주소는 전부 ClassNote 업로드 CDN(`up-kids-kage.kakao.com`)이고
--   **서명·만료 쿼리가 없다**(쿼리 0개) · 로그인 없이 GET 206 · `Cache-Control: max-age=315360000`(10년). 즉 만료되지 않는 주소(경로 자체가 열쇠인 capability URL)라
--   다시 받아 올 필요가 없다. 원본(`original`)은 저장하지 않고 `small`(격자)·`large`(크게 보기)·크기만 담는다(워커 `imageAttachments`).
--
-- 🔴 **별도 표 + 서버 전용**이다 — 원문 표(`classnote_parent_messages`)는 지점 직원 전원이 읽는 표라(0184a 정책) 거기 칸으로 두면 강사가 담당이 아닌 학생의
--    사진 주소를 PostgREST 직결로 읽는다(#77·#92). 이 표는 사용자 정책이 없다(RLS 켬 + 권한 회수) — 앱 서버가 답글 창을 열 때 **학생 상세와 같은 열람 게이트**
--    (students 메뉴 접근 + `getStudentById`)를 통과한 사람에게만 주소를 내려보낸다. 주소를 가진 쪽은 `<img referrerPolicy="no-referrer">`로 띄운다.
-- 🔴 앱·워커는 이 SQL 전에도 돈다([[#95]]): 워커는 표가 없으면(42P01) 10분간 사진 저장을 건너뛰고(로그 한 줄) 원문 저장·알림은 그대로 · 앱은 표가 없으면 사진 없이 쓰레드를 그린다.
--    적용 후 재시작은 필요 없다(워커가 10분 뒤 다시 시도). **이 SQL 이전에 온 글의 사진은 채워지지 않는다**(워커는 새 글·댓글만 읽는다 — 이미 읽은 글은 다시 안 읽는다).
-- 되돌리기: 별도 요청(표를 지우면 저장된 주소가 사라진다 — 이 파일에 되돌리기 SQL을 두지 않는다).
-- 멱등: create table if not exists · 정책 없음 · grant/revoke 반복 가능. 한 트랜잭션.

begin;

create table if not exists public.classnote_parent_message_attachments (
  message_id uuid primary key references public.classnote_parent_messages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- [{ small, large, width, height }] — 업로드 CDN 주소만(워커가 호스트를 거른다), 최대 10장
  attachments jsonb not null,
  created_at timestamptz not null default now(),
  constraint classnote_parent_message_attachments_array check (jsonb_typeof(attachments) = 'array')
);

create index if not exists classnote_parent_message_attachments_tenant_idx
  on public.classnote_parent_message_attachments (tenant_id, created_at desc);

alter table public.classnote_parent_message_attachments enable row level security;
revoke all on public.classnote_parent_message_attachments from anon, authenticated;
grant all on public.classnote_parent_message_attachments to service_role;

comment on table public.classnote_parent_message_attachments is
  '학부모 글·댓글의 ClassNote 사진 주소(0326a). 서버 전용 — 앱이 열람 게이트(학생 상세와 같은 판정) 뒤에서만 읽는다. 보관이 아니라 주소만(만료 없는 CDN 주소).';

notify pgrst, 'reload schema';

commit;
