-- s2_0067 되돌리기 — 조직·OKR 표를 지운다(목표·핵심결과·점검·피드백과 변경 기록이 함께 사라진다).
-- 🔴 적용 SQL이 아니다. 앱을 이 기능 이전 판으로 되돌린 **뒤에만**, 원장 승인 뒤 손으로 실행한다([[#95]]).
begin;
drop function if exists public.save_organization_okr(uuid,uuid,uuid,integer,text,jsonb,text,text);
drop table if exists public.organization_okr_revisions;
drop table if exists public.organization_okr;
commit;
notify pgrst, 'reload schema';
