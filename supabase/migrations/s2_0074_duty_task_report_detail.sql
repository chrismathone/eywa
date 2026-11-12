-- s2_0074 — duty_late 할 일 본문을 보고서처럼: 한 줄에 한 학생 "이름 — 항목 · 항목" (2026-11-10)
--
-- 왜: s2_0073의 본문 "이름(항목) · 이름(항목) · …" 한 덩어리가 읽히지 않았다(원장 2026-11-10 *"나열하지말고 제목 내용 등등 보고서처럼 정리"*).
-- 고침: detail = 줄바꿈(chr(10))으로 학생마다 한 줄 — 건별(신규생 콜)은 "이름 — 사전 콜 · OJT", 일간·월간은 "이름"(반 이름이 있으면 "이름 · 반"). 제목은 그대로.
--   앱(할 일 창)은 duty_late의 목록 줄엔 제목만, 상세에선 본문을 줄바꿈 그대로 보인다.
-- 되돌리기: duty_escalate를 s2_0073 본문으로.
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
  v_body text;
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
    select d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end) as grp_cycle,
           count(*) as n, min(d.due_at) as first_due,
           md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid as subject,
           array_agg(d.id) as ids
      from public.duty_items d
     where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
     group by d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end)
  loop
    -- 본문: 학생마다 한 줄. 건별은 "이름 — 항목 · 항목", 그 밖은 "이름 · 반".
    select string_agg(line, chr(10) order by line) into v_body from (
      select st.name || case when g.period = 'case'
                               then ' — ' || string_agg(duties_private.cycle_label(d.kind, d.cycle), ' · ' order by d.due_at)
                               else coalesce(' · ' || min(c.class_name), '') end as line
        from public.duty_items d join public.students st on st.id = d.student_id left join public.classes c on c.id = d.class_id
       where d.id = any(g.ids)
       group by st.id, st.name
    ) lines;
    select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
    select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
    v_title := duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건'
      || case when g.period = 'daily' then ' · ' || to_char(g.grp_cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.grp_cycle else '' end;
    v_task := staff_tasks_private.open_task(
      p_tenant, 'duty_late', g.subject, '',
      v_title,
      left(coalesce(v_body, ''), 1200),
      case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
           when g.kind in ('counsel_monthly', 'newcomer_call') then '/consultations/new'
           when g.kind = 'exam_monthly' then '/exams/input' else null end,
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
            and md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid = t.subject_id)
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
