-- s2_0073 — 건별(case) 의무의 늦음 할 일은 **담당자 × 종류에 하나**(항목마다 쪼개지 않는다) (2026-11-10)
--
-- 왜: 신규생 정착 콜은 회차(cycle)가 체크리스트 항목 키(pre_call · ojt · month1_call …)라, s2_0072까지의 묶음(담당자 × 종류 × 회차)이
--   항목마다 할 일을 하나씩 열어 같은 학생 이름이 든 "신규생 정착 콜 기한 초과 4건"이 네 줄로 보였다(원장 2026-11-10 *"똑같은 기한 초과가 중복으로"*).
-- 고침: period = 'case'면 묶음 열쇠의 회차를 ''로 — 담당자 × 종류에 하나. 본문은 "이름(항목) · 이름(항목)". 일간·월간은 그대로(날짜·달마다 하나).
--   항목별로 열려 있던 옛 할 일은 늦은 의무가 새 묶음으로 옮겨가며 'cancelled'(duties_moved_or_void)로 닫히고, 새 할 일 하나가 선다(한 번뿐).
-- 되돌리기: duty_escalate를 s2_0072 본문으로.
-- 연동 역할 실행권 확인: duties_private 함수는 장부 맞춤(앱 service_role)만 부른다 — 연동 PC 질의·RLS 정책이 지나지 않는다.
begin;

create or replace function duties_private.cycle_label(p_kind text, p_cycle text) returns text
language sql immutable
as $fn$
  select case when p_kind = 'newcomer_call' then
    case p_cycle when 'pre_call' then '사전 콜' when 'first_class_guide' then '첫 수업 안내' when 'ojt' then 'OJT' when 'after_first_call' then '첫 수업 후 콜'
                 when 'month1_call' then '1개월 콜' when 'month2_call' then '2개월 콜' when 'month3_call' then '3개월 콜' else p_cycle end
  else p_cycle end;
$fn$;

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

  -- 묶음 = 담당자 × 종류 × (일간·월간은 회차 · 건별은 '') — 열쇠 md5는 닫기 루프와 같은 식.
  for g in
    select d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end) as grp_cycle,
           count(*) as n, min(d.due_at) as first_due,
           md5(p_tenant::text || ':' || coalesce(d.owner_id::text, 'none') || ':' || d.kind || ':' || (case when d.period = 'case' then '' else d.cycle end))::uuid as subject,
           array_agg(d.id) as ids
      from public.duty_items d
     where d.tenant_id = p_tenant and d.status = 'open' and d.due_at < v_now
     group by d.owner_id, d.kind, d.period, (case when d.period = 'case' then '' else d.cycle end)
  loop
    select string_agg(st.name || case when g.period = 'case' then '(' || duties_private.cycle_label(d.kind, d.cycle) || ')' else '' end, ' · ' order by st.name, d.due_at) into v_names
      from public.duty_items d join public.students st on st.id = d.student_id
     where d.id = any(g.ids);
    select bool_or(d.subject = 'english') into v_english from public.duty_items d where d.id = any(g.ids);
    select exists (select 1 from public.users u where u.id = g.owner_id and u.tenant_id = p_tenant and u.status = 'active') into v_active;
    v_title := duties_private.kind_label(g.kind) || ' 기한 초과 ' || g.n || '건'
      || case when g.period = 'daily' then ' · ' || to_char(g.grp_cycle::date, 'MM/DD') when g.period = 'monthly' then ' · ' || g.grp_cycle else '' end;
    v_task := staff_tasks_private.open_task(
      p_tenant, 'duty_late', g.subject, '',
      v_title,
      left(v_title || coalesce(' — ' || v_names, ''), 600),
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

revoke all on all functions in schema duties_private from public, anon, authenticated;
grant execute on all functions in schema duties_private to service_role;
notify pgrst, 'reload schema';
commit;
