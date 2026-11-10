-- s2_0043 — 의무 장부: void → void로 까닭만 바뀌어도 받아 적는다 (2026-11-10)
--
-- 왜: 결석으로 빠진 보고서 칸을 "결석"이라 적으려고(원장 2026-11-10 *"의무 없음 → 결석"*) 생성기가 void('absent') 행을 넘기는데,
--   s2_0041의 duty_resolve_items는 **상태가 같으면 건너뛰어** 먼저 'not_due'로 void된 행의 까닭이 그대로 남았다(운영 확인: 11/9 3행).
-- 고침: status가 같아도 void이고 source(까닭)가 다르면 void_reason을 갱신. done의 done_source는 처음 것을 지킨다(종전과 같다).
-- 되돌리기: duty_resolve_items를 s2_0041 본문으로.
begin;

create or replace function public.duty_resolve_items(p_tenant uuid, p_updates jsonb) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_done int := 0;
  v_void int := 0;
  v_reopened int := 0;
begin
  with src as (
    select x.kind, x."subjectKey" as subject_key, x.cycle, x.status, x.source, x."doneAt" as done_at
      from jsonb_to_recordset(coalesce(p_updates, '[]'::jsonb)) as x(kind text, "subjectKey" text, cycle text, status text, source text, "doneAt" timestamptz)
     where x.status in ('done', 'void', 'open')
  ), upd as (
    update public.duty_items d
       set status = s.status,
           done_at = case when s.status = 'done' then coalesce(d.done_at, s.done_at, now()) else null end,
           done_source = case when s.status = 'done' then coalesce(s.source, d.done_source) else null end,
           void_reason = case when s.status = 'void' then coalesce(s.source, d.void_reason) else null end,
           escalation = case when s.status = 'open' then 0 else d.escalation end,
           escalated_at = case when s.status = 'open' then null else d.escalated_at end,
           task_id = case when s.status = 'open' then null else d.task_id end,
           updated_at = now()
      from src s
     where d.tenant_id = p_tenant and d.kind = s.kind and d.subject_key = s.subject_key and d.cycle = s.cycle
       and (d.status is distinct from s.status
            or (s.status = 'void' and s.source is not null and d.void_reason is distinct from s.source))
    returning d.status
  )
  select count(*) filter (where status = 'done'), count(*) filter (where status = 'void'), count(*) filter (where status = 'open')
    into v_done, v_void, v_reopened from upd;
  return jsonb_build_object('done', v_done, 'void', v_void, 'reopened', v_reopened);
end;
$fn$;

notify pgrst, 'reload schema';
commit;
