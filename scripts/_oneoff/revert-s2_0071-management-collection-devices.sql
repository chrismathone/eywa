-- s2_0071 되돌리기 — 학원 PC 수집기 기기 연결 · 지점 스위치 표를 지운다(설치된 PC의 다음 요청부터 거절된다).
-- 🔴 앱을 먼저 되돌린 뒤.
begin;
drop table if exists public.management_collection_settings;
drop table if exists public.management_collection_devices;
commit;
