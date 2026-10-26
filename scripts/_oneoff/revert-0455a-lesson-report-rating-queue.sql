-- 0455a 되돌리기 — 평점 정기 처리 대기열 표를 지우고 입력 지문 칸을 뗀다.
-- ⚠️ 먼저 운영 콘솔에서 지점 스위치 'report_rating'을 끄고 cron이 멈췄는지 확인한 뒤 돌린다.
-- ⚠️ 정기 처리가 저장한 평점(lesson_report_ratings, rubric = 'v4-check7-app1' — 10-22 오프라인 배치분과 칸으로 갈린다)은 남는다 — 지우려면 아래 주석 줄을 따로.
begin;
set local lock_timeout = '5s';
drop table if exists public.lesson_report_rating_queue;
alter table public.lesson_report_ratings drop column if exists input_hash;
-- delete from public.lesson_report_ratings where rubric = 'v4-check7-app1';
commit;
notify pgrst, 'reload schema';
