-- revert-s2_0067-assistant-mask-resident-no.sql — s2_0067(학원 비서 보기의 주민번호 가림)을 되돌린다.
-- 🔴 되돌리면 비서(AI)가 이력서 주민번호 13자리를 다시 읽는다 — 원장 승인 없이 돌리지 말 것(원장 2026-11-11 *"주민번호 앞자리 6개 및 뒷자리 1개만 보내"*).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
delete from assistant_private.masked_columns
 where (table_name, column_name) in (('academy_documents', 'form_data'), ('payslips', 'print_payload'));
select public.assistant_refresh_views_if_stale();
commit;
