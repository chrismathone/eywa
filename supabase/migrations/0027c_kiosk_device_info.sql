-- 0027b — 키오스크 기기 메타(IP·User-Agent) 컬럼 추가. 멱등 additive.
-- 손수 alpha(drizzle migrate 미경유). 0027a 다음.

begin;

alter table public.kiosk_devices add column if not exists registered_ip text;
alter table public.kiosk_devices add column if not exists last_seen_ip text;
alter table public.kiosk_devices add column if not exists user_agent text;

commit;
