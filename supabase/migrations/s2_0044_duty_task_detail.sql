-- s2_0044 — 의무 장부 → 할 일(duty_late)의 본문에 **무슨 업무인지**를 적는다 (2026-11-10)
--
-- 왜: 할 일 창은 굵은 줄에 `detail ?? title`을 쓴다(staff-task-dialog.tsx). s2_0041~0043의 duty_escalate는 detail에 학생 이름만 넣어
--   "김지유A · 전유슬 / 할 일 · 26.11.09 22:12"처럼 **어떤 업무가 기한을 넘겼는지가 안 보였다**(원장 2026-11-10 *"어떤 업무를 기한 초과 했는지 하나도 알 수가 없음"*).
-- 고침: detail = "<종류> 기한 초과 N건 · 11/09 — 이름 · 이름"(title + 이름). title은 그대로. 열린 할 일은 open_task가 글만 새로 맞춘다.
-- 되돌리기: duty_escalate를 s2_0042 본문으로.
begin;

create or replace function public.duty_escalate(p_tenant uuid, p_manager_days int default 3, p_owner_days int default 7, p_expire_days int default 7) returns jsonb
language plpgsql security definer set search_path = public
as $fn$
declare
  v_now timestamptz := now();
  v_opened int := 0;
  v_closed int := 0;
  v_task uuid;
  g record;
  v_names text;
  v_title text;
  v_english boolean;
  v_active boolean;
begin
  update public.duty_items set status = 'void', void_reason = 'expired', updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and period = 'daily' and due_at + make_interval(days => p_expire_days) < v_now;

  update public.duty_items set escalation = 1, escalated_at = coalesce(escalated_at, v_now), updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 1 and due_at < v_now;
  update public.duty_items set escalation = 2, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 2 and due_at + make_interval(days => p_manager_days) < v_now;
  update public.duty_items set escalation = 3, updated_at = v_now
   where tenant_id = p_tenant and status = 'open' and escalation < 3 and due_at + make_interval(days => p_owner_days) < v_now;

  for g in
    select d.owner_id, d.kind, d.cycle, d.period, count(*) as n, min(d.due_at) as first_due,
           md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || d.cycle)::uuid as subject,
           array_agg(d.id) as ids
      from public.duty_items d
     where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
     group by d.owner_id, d.kind, d.cycle, d.period
  loop
    select string_agg(st.name, ' · ' order by st.name) into v_names
      from public.duty_items d join public.students st on st.id = d.student_id
     where d.id = any(g.ids);
    select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
    select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
    v_title := duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건'
      || case when g.period = 'daily' then ' · ' || to_char(g.cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.cycle else '' end;
    v_task := staff_tasks_private.open_task(
      p_tenant, 'duty_late', g.subject, '',
      v_title,
      left(v_title || coalesce(' — ' || v_names, ''), 400),
      case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
           when g.kind = 'counsel_monthly' then '/consultations/new'
           when g.kind = 'exam_monthly' then '/grades'
           when g.kind = 'newcomer_call' then '/newcomers' else null end,
      g.first_due + interval '1 day',
      case when g.owner_id is null or not v_active then staff_tasks_private.master_ids(p_tenant) else array[g.owner_id] end,
      null);
    update public.duty_items set task_id = v_task, updated_at = v_now where id = any(g.ids) and task_id is distinct from v_task;
    v_opened := v_opened + 1;
  end loop;

  for g in
    select t.id, t.subject_id,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.status = 'done') as any_done,
           exists (select 1 from public.duty_items d where d.task_id = t.id and d.void_reason = 'expired') as any_expired
      from public.staff_tasks t
     where t.tenant_id = p_tenant and t.kind = 'duty_late' and t.status = 'open'
       and not exists (
         select 1 from public.duty_items d
          where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || d.cycle)::uuid = t.subject_id)
  loop
    v_closed := v_closed + staff_tasks_private.close_task(p_tenant, 'duty_late', g.subject_id, '',
      case when g.any_done then 'done' when g.any_expired then 'expired' else 'cancelled' end,
      case when g.any_done then 'duties_resolved' when g.any_expired then 'duties_expired' else 'duties_moved_or_void' end, null);
  end loop;
  return jsonb_build_object('opened', v_opened, 'closed', v_closed);
end;
$fn$;

notify pgrst, 'reload schema';
commit;
