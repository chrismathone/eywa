-- s2_0038 되돌리기 — 앱을 s2_0038 이전 판으로 되돌린 **뒤에만** 쓴다(새 앱은 결과 칸을 읽는다).
-- 🔴 재측정 결과(판정·값)가 함께 지워진다 — 원장 확인 뒤에만. 의견·처리 기록(s2_0036)은 그대로 남는다.
-- 재측정을 마친 의견(measure_state measured·broken)은 다음 앱이 다시 재지 않게 그대로 둔다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.assistant_advice drop constraint if exists assistant_advice_latest_complete;
alter table public.assistant_advice
  drop column if exists latest_verdict,
  drop column if exists latest_value,
  drop column if exists latest_sample,
  drop column if exists latest_base,
  drop column if exists latest_base_sample,
  drop column if exists latest_from,
  drop column if exists latest_to,
  drop column if exists latest_delta,
  drop column if exists latest_threshold,
  drop column if exists latest_reason,
  drop column if exists latest_checked_at,
  drop column if exists checks_done,
  drop column if exists fail_count,
  drop column if exists last_error,
  drop column if exists measure_anchor;
commit;

notify pgrst, 'reload schema';
