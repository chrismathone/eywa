-- s2_0055 되돌리기 — 강사 배정 상한 표·이력·저장 함수를 지운다(저장한 상한과 근거가 함께 사라진다).
-- 🔴 앱을 먼저 되돌린 뒤(강사 통합 기록 화면은 표가 없으면 '조회 확인 필요'로 보인다).
begin;
drop function if exists public.save_teacher_capacity_plan(uuid, uuid, uuid, text, integer, uuid, integer, text);
drop table if exists public.teacher_capacity_events;
drop table if exists public.teacher_capacity_plans;
commit;
