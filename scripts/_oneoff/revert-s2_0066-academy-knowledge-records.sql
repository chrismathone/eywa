-- s2_0066 되돌리기 — 현장 관찰·후속 조치·OKR·운영 보완 자료 표를 지운다(모든 버전이 함께 사라진다).
-- 🔴 적용 SQL이 아니다. 앱을 이 기능 이전 판으로 되돌린 **뒤에만**, 원장 승인 뒤 손으로 실행한다([[#95]]).
begin;
drop trigger if exists academy_knowledge_append_only on public.academy_knowledge_records;
drop table if exists public.academy_knowledge_records;
drop function if exists public.guard_academy_knowledge_record();
commit;
notify pgrst, 'reload schema';
