-- s2_0062 되돌리기 — 앱을 먼저 되돌린 뒤. 🔴 과목별 관리 담당 배정·기본 담당이 함께 사라진다.
begin;
drop table public.student_onboarding_subject_assignments;
drop table public.student_onboarding_manager_defaults;
drop function public.validate_onboarding_subject_manager();
notify pgrst, 'reload schema';
commit;
