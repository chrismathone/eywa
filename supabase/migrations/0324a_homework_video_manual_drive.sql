-- 0324a — 숙제 영상 **출처** 칸 + 담임 폴더에 사람이 **직접 올린** 영상 담기 (2026-10-01).
--
-- 원장 2026-10-01 *"따로 클래스노트에 업로드가 힘들어서 개별로 드라이브에 제출하는 경우에도 매핑시킬 수 있는지 검토. 대신 양식은
-- 클래스노트 자동 업로드와 맞출 예정"* · *"같은 폴더 안에 올릴 거야 … '이수진 선생님'처럼"* · *"관리자가 업로드할 것이니까"*.
-- 학부모가 ClassNote에 못 올린 영상을 선생님·관리자가 받아 워커의 담임 폴더에 `학생_반_학교학년_날짜.mp4`로 올리면, 워커가
-- 10분마다 그 폴더를 **읽어**(옮기거나 이름을 바꾸지 않는다) 학생·반에 붙인다(scripts/_classnote/video-manual-scan.mjs).
--
-- ① source — 'classnote'(지금까지의 전부, 기본값) · 'drive'(담임 폴더 직접 업로드) · 'link'(aywa 제출 링크 — 다른 브랜치가 쓴다, 미리 허용).
-- ② source_ref — 출처 안의 식별자. drive = Drive 파일 ID, link = 그 제출 번호. classnote는 비워 둔다(기존 (기관, 영상 번호) 유니크가 맡는다).
--    유니크 = **일반** 유니크 (tenant_id, source, source_ref) — 부분 유니크는 `ON CONFLICT` 타깃이 안 된다([[#113]]). NULL은 서로 안 겹쳐
--    classnote 행끼리는 막지 않는다.
--    🔴 (tenant_id, drive_file_id) 유니크로 하지 말 것 — 워커는 같은 폴더·같은 내용(MD5·크기)의 영상 두 건을 **한 Drive 파일로 합친다**
--       (설계, video-worker `existingFileId`). 2026-10-01 실측으로 이미 1쌍이 같은 파일 ID를 나눠 쓰고 있어 그 인덱스는 만들어지지도 않고,
--       만들어지면 그 합치기가 전부 실패한다.
-- ③ ClassNote 번호 세 칸(center_id·video_id·post_id) NOT NULL 해제 — 직접 올린 영상엔 번호가 없다. 대신 classnote 행은 셋 다 있어야 한다
--    (아래 check). 기존 유니크 (tenant_id, center_id, video_id)는 그대로 — NULL끼리는 겹치지 않으므로 직접 업로드 행을 막지 않는다.
-- ④ status에 'review'(확인 필요) 추가 — 파일 이름으로 학생·반을 못 찾았거나 이미 보관된 영상과 같은 파일. 학생·반을 비워 두므로
--    학생 상세 '숙제 영상' 탭(학생으로 거른다)과 영상 제출 장부(반으로 분류된 것만 센다) 어디에도 잡히지 않고, 워커의 작업 선점
--    (queued·failed·processing만)도 집지 않는다. 이름을 고치면 다음 훑기에 다시 판정한다.
--
-- 🔴 앱·워커는 이 SQL 전에도 돈다([[#95]]): 워커는 source·source_ref 칸이 없으면 직접 업로드 훑기를 건너뛰고(로그 한 번), 학생 탭은
--    source 칸이 없으면 옛 조회로 돌아간다. 적용 후 재시작은 필요 없다(워커가 10분마다 칸을 다시 확인한다).
-- 되돌리기: 별도 요청(칸을 지우면 직접 올린 영상의 기록이 사라진다 — 이 파일에 되돌리기 SQL을 두지 않는다).
-- 멱등: add column if not exists · 제약은 지우고 다시 · create unique index if not exists. 한 트랜잭션.

begin;

alter table public.student_homework_videos
  add column if not exists source text not null default 'classnote';
alter table public.student_homework_videos
  add column if not exists source_ref text;

alter table public.student_homework_videos drop constraint if exists student_homework_videos_source_check;
alter table public.student_homework_videos
  add constraint student_homework_videos_source_check check (source in ('classnote', 'drive', 'link'));

alter table public.student_homework_videos alter column center_id drop not null;
alter table public.student_homework_videos alter column video_id drop not null;
alter table public.student_homework_videos alter column post_id drop not null;

-- classnote 행은 ClassNote 번호 셋이 다 있어야 하고(지금까지와 같은 보장), 다른 출처 행은 출처 식별자가 있어야 한다(중복 방지 열쇠).
alter table public.student_homework_videos drop constraint if exists student_homework_videos_source_ids_check;
alter table public.student_homework_videos
  add constraint student_homework_videos_source_ids_check check (
    case when source = 'classnote' then center_id is not null and video_id is not null and post_id is not null
         else source_ref is not null end);

alter table public.student_homework_videos drop constraint if exists student_homework_videos_status_check;
alter table public.student_homework_videos
  add constraint student_homework_videos_status_check check (status in ('queued', 'processing', 'uploaded', 'failed', 'review'));

create unique index if not exists student_homework_videos_source_ref_key
  on public.student_homework_videos (tenant_id, source, source_ref);
-- 같은 내용 판정(직접 올린 사본 ↔ ClassNote 수집분)용.
create index if not exists student_homework_videos_md5_idx
  on public.student_homework_videos (tenant_id, md5, bytes) where md5 is not null;

comment on column public.student_homework_videos.source is
  '영상 출처: classnote(ClassNote 학부모 글·댓글 수집) · drive(담임 폴더에 직접 올림) · link(aywa 제출 링크).';
comment on column public.student_homework_videos.source_ref is
  '출처 안의 식별자 — drive: Drive 파일 ID, link: 제출 번호. classnote는 비움(center_id·video_id가 맡는다).';

commit;

notify pgrst, 'reload schema';
