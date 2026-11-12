-- revert-s2_0068-prep-brief-job-at.sql — 앱을 먼저 되돌린 뒤 실행한다(새 앱은 이 칸을 읽고 쓴다).
begin;
set local lock_timeout = '5s';
alter table public.enrollment_consultations drop column if exists prep_brief_job_at;
notify pgrst, 'reload schema';
commit;
