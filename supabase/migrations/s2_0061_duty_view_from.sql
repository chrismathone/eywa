-- s2_0061 — 업무 완성도: 볼 수 있는 첫 날(duty_settings.view_from) (2026-11-11)
--
-- 왜: 원장 2026-11-11 — 2026년 전체를 다시 만들었지만 3~7월은 에이와에 출결을 적기 전이라 출결 기한 준수 0~2%다(기록이 없는 달).
--   선생님 평가로 읽히면 안 되므로 그 달들은 관리 화면에서 고르지 못하게 한다. 장부 행은 그대로 둔다.
-- 무엇: `duty_settings.view_from date`(null = 제한 없음). 관리 화면이 이보다 앞선 기간으로 가지 않고, 집계도 이 날부터만 센다.
--   지점 값은 운영자가 넣는다(침산 = 2026-08-01).
-- 되돌리기: alter table public.duty_settings drop column view_from; (앱이 이 칸을 읽으므로 앱을 먼저 되돌린다)
begin;

alter table public.duty_settings add column if not exists view_from date;

commit;
