-- 되돌리기 — 0394a 시간표 칸 메모(`supabase/migrations/0394a_timetable_cell_memos.sql`).
-- 🔴 적용 SQL이 아니다. 표를 지우면 메모가 전부 사라진다(이전 내용은 감사로그 metadata.before에만 남는다).
-- 앱은 표가 없으면 메모 없이 강사뷰를 그대로 연다 — 되돌린 뒤 앱을 따로 되돌릴 필요는 없다.
begin;
set local lock_timeout = '5s';
drop table if exists public.timetable_cell_memos;
commit;
