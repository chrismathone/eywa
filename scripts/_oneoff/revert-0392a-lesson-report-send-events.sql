-- ⚠️ 실행하지 마세요 — 0392a(수업보고서 발송 이력)를 되돌리고 싶을 때만.
--
-- 이 파일은 **기록을 멈추기만** 한다(트리거·함수 제거). 이미 쌓인 이력 표(lesson_report_send_events)는 남긴다 —
-- 발송 이력은 다시 만들 수 없는 기록이라 표를 지우는 것은 원장이 따로 결정한다(맨 아래 주석).
-- 앱은 이 표를 읽지도 쓰지도 않으므로 되돌려도 앱 동작은 그대로다.
begin;
set local lock_timeout = '5s';
drop trigger if exists lesson_report_send_events_u on public.lesson_reports;
drop trigger if exists lesson_report_send_events_i on public.lesson_reports;
drop trigger if exists lesson_report_send_events_d on public.lesson_reports;
drop function if exists lesson_report_send_private.capture();
commit;

-- 표까지 지우려면(되돌릴 수 없다 — 쌓인 발송 이력이 모두 사라진다), 원장이 정한 뒤에만:
--   drop trigger if exists lesson_report_send_events_guard on public.lesson_report_send_events;
--   drop table if exists public.lesson_report_send_events;
--   drop schema if exists lesson_report_send_private cascade;
