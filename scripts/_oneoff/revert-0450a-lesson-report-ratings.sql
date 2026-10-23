-- 0450a 되돌리기 — 수업보고서 평점 표를 지운다(올린 평점도 함께 사라진다).
-- 🔴 적용 SQL이 아니다. 되돌릴 때만 원장 승인 뒤 손으로 실행한다.
-- 앱은 표가 없어도 목록을 평점 없이 그대로 보여 준다([[#95]]).
drop table if exists public.lesson_report_ratings;

notify pgrst, 'reload schema';
