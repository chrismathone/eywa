-- s2_0083 — 업무 완성도: 맞춤이 '발송 의무로 합쳐진 작성 의무'(merged)를 되살리지 않는다 (2026-11-11)
--
-- 왜(Codex 종합 리뷰 2026-11-11): 보고서를 발송까지 한 업무로 합치며(2026-11-10) 같은 열쇠의 옛 작성 의무를 void(`merged`)로 정리했다.
--   그런데 `duty_resolve_items`(s2_0078)는 면제(`waived`)만 지키고 `merged`는 지키지 않아, 작성 의무 초안을 아직 내는 쪽(옛 판 앱 · 되돌린 코드)이
--   한 번이라도 맞추면 그 행이 되살아나 작성 · 발송이 다시 두 번 세진다.
-- 무엇: `duty_resolve_items` — `merged`도 건드리지 않는다. 그 밖은 s2_0078 본문 그대로.
-- 되돌리기: s2_0078의 duty_resolve_items 본문으로.
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
       and coalesce(d.void_reason, '') not in ('waived', 'merged')
       and (d.status is distinct from s.status
            or (s.status = 'void' and s.source is not null and d.void_reason is distinct from s.source))
    returning d.status
  )
  select count(*) filter (where status = 'done'), count(*) filter (where status = 'void'), count(*) filter (where status = 'open')
    into v_done, v_void, v_reopened from upd;
  return jsonb_build_object('done', v_done, 'void', v_void, 'reopened', v_reopened);
end;
$fn$;

commit;
