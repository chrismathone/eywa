-- s2_0066 되돌리기 — 신규생 '과목 기본 담당' 변경의 감사 트리거를 없앤다.
-- 🔴 적용 SQL이 아니다. 앱을 먼저 되돌릴 필요는 없다(앱의 저장은 트리거가 없어도 된다) — 다만 되돌린 동안의 기본 담당 변경은
--    감사로그에 남지 않는다(앱은 따로 logAction을 부르지 않는다 — 기록은 이 트리거 하나다).
-- 이미 남은 감사로그 줄(action = 'newcomer_default_manager_update')과 기본 담당 표의 값은 건드리지 않는다.
begin;
drop trigger if exists onboarding_default_manager_audit on public.student_onboarding_manager_defaults;
drop function if exists public.audit_onboarding_default_manager();
commit;
