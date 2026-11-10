-- s2_0070 되돌리기 — 경영 분석 회계 자료 · 대조 기록 · 확인 이력 표와 저장 함수를 지운다.
-- 🔴 앱(경영 분석 화면 · /api/management/*)을 먼저 되돌린 뒤. 저장한 회계 자료·대조 기록·확인 이력이 함께 사라진다.
-- s2_0071(수집기)·s2_0072(AI 검토)가 적용돼 있으면 그것을 먼저 되돌릴 것.
begin;
drop function if exists public.append_management_review(uuid, uuid, uuid, text, integer, text, text, date, text);
drop function if exists public.save_management_accounting(uuid, uuid, jsonb, integer);
drop table if exists public.management_review_events;
drop table if exists public.management_source_batches;
drop table if exists public.management_accounting_versions;
drop table if exists public.management_accounting_reports;
commit;
