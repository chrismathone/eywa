-- s2_0044 되돌리기 — 원생상담 평점 표와 정기 처리 대기열 표를 지운다.
-- ⚠️ 먼저 운영 콘솔에서 지점 스위치 'consult_rating'을 끄고 cron(/api/cron/consultation-ratings)이 멈췄는지 확인한 뒤 돌린다.
-- ⚠️ 평점 값(student_consultation_ratings)까지 지워진다 — 값만 남기고 대기열만 지우려면 아래 첫 줄만 돌린다.
begin;
set local lock_timeout = '5s';
drop table if exists public.student_consultation_rating_queue;
drop table if exists public.student_consultation_ratings;
commit;
notify pgrst, 'reload schema';
