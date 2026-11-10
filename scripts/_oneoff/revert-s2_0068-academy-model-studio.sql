-- s2_0068 되돌리기 — 스키마 스튜디오 변경 기록(항목 정의·연결 점검 기준·참고 연결)을 지운다.
-- 🔴 적용 SQL이 아니다. 앱을 이 기능 이전 판으로 되돌린 **뒤에만**, 원장 승인 뒤 손으로 실행한다([[#95]]).
begin;
drop trigger if exists academy_model_version_guard on public.academy_model_versions;
drop table if exists public.academy_model_versions;
drop function if exists public.guard_academy_model_version();
commit;
notify pgrst, 'reload schema';
