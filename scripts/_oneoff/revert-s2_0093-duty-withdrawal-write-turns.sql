-- s2_0093 되돌리기 — 트리거 · 집계 함수만 내린다. 모인 차례 기록(withdrawal_write_turns)은 지우지 않는다(다시 올리면 그대로 이어 쓴다).
begin;
drop trigger if exists staff_tasks_capture_withdrawal_write_turn on public.staff_tasks;
drop function if exists public.duty_withdrawal_write_items(uuid, date, date, text[], uuid);
drop function if exists public.duty_withdrawal_write_rollup(uuid, date, date, text[], uuid);
drop function if exists duties_private.withdrawal_write_rows(uuid, date, date, text[], uuid);
drop function if exists staff_tasks_private.capture_withdrawal_write_turn();
notify pgrst, 'reload schema';
commit;
