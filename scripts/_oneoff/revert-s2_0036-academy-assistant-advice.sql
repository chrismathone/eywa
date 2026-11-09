-- s2_0036 되돌리기 — 앱을 s2_0036 이전 판으로 되돌린 **뒤에만** 쓴다(새 앱은 assistant_advice에 쓴다).
-- 🔴 의견 기록·처리 이력·기준값이 함께 지워진다(되살릴 수 없다) — 원장 확인 뒤에만.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop table if exists public.assistant_advice_events;
drop table if exists public.assistant_advice;
drop function if exists assistant_private.advice_event_guard();
drop function if exists assistant_private.advice_guard();
delete from assistant_private.excluded_tables where table_name in ('assistant_advice', 'assistant_advice_events');

do $$
begin
  if to_regclass('public.assistant_advice') is not null or to_regclass('public.assistant_advice_events') is not null then
    raise exception 's2_0036 되돌리기: 표가 남았습니다';
  end if;
end $$;
commit;

notify pgrst, 'reload schema';
