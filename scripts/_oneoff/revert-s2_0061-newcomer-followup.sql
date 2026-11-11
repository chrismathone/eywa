-- s2_0061 되돌리기 — 앱을 먼저 되돌린 뒤 · s2_0062을 먼저 되돌릴 것(트리거 함수를 같이 쓴다).
-- 🔴 적힌 적응 피드백·확인·후속 조치 기록과 변경 이력이 함께 사라진다.
begin;
drop table public.student_onboarding_followup_events;
drop table public.student_onboarding_feedback;
drop function public.audit_onboarding_followup();
drop function public.validate_onboarding_followup();
notify pgrst, 'reload schema';
commit;
