-- s2_0062 되돌리기 — 앱을 먼저 되돌린 뒤. 🔴 전화·방문·등록 확인 기록과 변경 이력이 함께 사라진다.
begin;
drop function public.save_enrollment_journey(uuid,uuid,uuid,uuid,integer,jsonb,boolean,text);
drop table public.enrollment_journey_revisions;
drop table public.enrollment_journey_records;
notify pgrst, 'reload schema';
commit;
