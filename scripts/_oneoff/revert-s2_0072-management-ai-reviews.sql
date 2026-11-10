-- s2_0072 되돌리기 — 경영 분석 AI 검토 결과 보관 표를 지운다(보관한 검토 결과가 함께 사라진다).
-- 🔴 앱을 먼저 되돌린 뒤.
begin;
drop table if exists public.management_ai_reviews;
commit;
