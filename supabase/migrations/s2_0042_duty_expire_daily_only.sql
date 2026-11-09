-- s2_0042 — 의무 장부: '기한 뒤 7일 → 기한 지남 확정'은 **일간 의무에만** (2026-11-09 밤)
--
-- 왜: s2_0041의 duty_escalate가 모든 주기의 열린 의무를 due_at + 7일에 void('expired')로 확정했다. 일간(출결·보고서·발송)엔 맞지만
--   건별(신규생 정착 콜 — 등록 후 90일 창 안에서 계속 해야 할 일)과 월간(월 학부모 상담)은 기한이 지나도 **열린 채 늦음**으로 남아야
--   화면·할 일에서 "아직 안 했다"가 보인다. 첫 생성에서 신규생 콜 110건이 곧바로 expired로 묻혔다(운영 확인 2026-11-09).
-- 고침: 확정 조건에 period = 'daily'. 이미 잘못 확정된 일간 아닌 expired 행은 다시 연다(사다리 단계·할 일 연결은 0부터).
-- 되돌리기: duty_escalate를 s2_0041 본문으로.
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
  v_english boolean;
  v_active boolean;
begin
  -- 기한 뒤 p_expire_days가 지나도록 열린 **일간** 의무는 '기한 지남'으로 확정(void · expired) — 더는 다시 맞추지 않는 날이라(duty_open_cycles 창) 열어 두면 영영 안 닫힌다.
  -- 월간·건별은 열린 채 늦음으로 남긴다(s2_0042). 분모엔 남고 미완으로 센다(snapshot · counts). 할 일은 아래 닫기 루프에서 'expired'.
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
    v_task := staff_tasks_private.open_task(
      p_tenant, 'duty_late', g.subject, '',
      duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건' || case when g.period = 'daily' then ' · ' || to_char(g.cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.cycle else '' end,
      left(v_names, 300),
      case when g.kind in ('attendance', 'report_write', 'report_send', 'video_check') then (case when coalesce(v_english, false) then '/ecs' else '/onescreen' end)
           when g.kind = 'counsel_monthly' then '/consultations/new'
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

-- 잘못 확정된 일간 아닌 행 되돌리기(2026-11-09 첫 생성분).
update public.duty_items
   set status = 'open', void_reason = null, escalation = 0, escalated_at = null, task_id = null, updated_at = now()
 where period <> 'daily' and status = 'void' and void_reason = 'expired';

notify pgrst, 'reload schema';
commit;
