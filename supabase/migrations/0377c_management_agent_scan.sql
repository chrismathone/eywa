begin;
create or replace function public.management_case_event(c public.management_cases, k text, a uuid default null, n text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.management_case_events(tenant_id,case_id,event_key,kind,actor_id,note)
  values(c.tenant_id,c.id,'v' || c.version || ':' || k,k,a,n) on conflict do nothing;
$$;
revoke all on function public.management_case_event(public.management_cases,text,uuid,text) from public, anon, authenticated;

-- Service-only. Database time and source rows are authoritative, no client evidence/clock accepted.
create or replace function public.management_agent_scan(p_tenant uuid, p_consultation uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare cfg jsonb; c public.management_cases; s public.student_consultations; owner_id uuid;
  today date := (now() at time zone 'Asia/Seoul')::date; changed integer := 0;
  event_kind text; active_mode boolean; ack_days integer; reminder_days integer;
begin
  -- Serialize cron/manual scans, but never wait behind another run for this academy.
  if not pg_try_advisory_xact_lock(hashtextextended('management-agent:' || p_tenant,0)) then return 0; end if;
  select data #> '{notifications,managementAgent}' into cfg from public.tenant_settings where tenant_id = p_tenant;
  if coalesce(cfg->>'mode','off') not in ('observe','active') then return 0; end if;
  active_mode := cfg->>'mode' = 'active';
  ack_days := greatest(1,least(14,coalesce((cfg->>'acknowledgeDays')::integer,1)));
  reminder_days := greatest(1,least(30,coalesce((cfg->>'reminderDays')::integer,3)));
  -- Same due/undone predicate as notifications.detectFollowup; SQL avoids PostgREST's 1,000-row cap.
  for c in
    insert into public.management_cases(tenant_id,consultation_id,student_id,source_counselor_id,assignee_id,source_due_on,announced)
    select src.tenant_id,src.id,src.student_id,src.counselor_id,u.id,src.follow_up_date,active_mode
      from public.student_consultations src
      left join public.users u on u.id = src.counselor_id and u.tenant_id = src.tenant_id and u.status = 'active'
      where src.tenant_id = p_tenant and src.follow_up_done = false and src.follow_up_date <= today
        and (p_consultation is null or src.id = p_consultation)
    on conflict (tenant_id,consultation_id) do nothing returning *
  loop
    perform public.management_case_event(c,'detected'); changed := changed + 1;
  end loop;
  for c in select * from public.management_cases where tenant_id = p_tenant
    and (p_consultation is null or consultation_id = p_consultation) order by id for update
  loop
    event_kind := null;
    select * into s from public.student_consultations where id = c.consultation_id and tenant_id = p_tenant;
    if not found or s.follow_up_date is null or s.student_id <> c.student_id then
      if c.status not in ('blocked','dismissed') then c.status := 'blocked'; event_kind := 'source_missing'; end if;
    else
      select id into owner_id from public.users where id = s.counselor_id and tenant_id = p_tenant and status = 'active';
      if s.follow_up_date <> c.source_due_on or s.counselor_id is distinct from c.source_counselor_id
        or owner_id is distinct from c.assignee_id or c.status = 'blocked'
        or (c.source_done and not s.follow_up_done) then
        c.episode := c.episode + 1;
        c.status := case when s.follow_up_done then 'waiting_review' else 'open' end;
        c.result_kind := null; c.result_note := null; c.verification_note := null;
        c.acknowledged_at := null; c.next_check_on := s.follow_up_date;
        c.last_reminded_on := null;
        event_kind := case when c.source_done and not s.follow_up_done then 'reopened' else 'source_changed' end;
      elsif s.follow_up_done and not c.source_done and c.status not in ('resolved','dismissed') then
        c.status := 'waiting_review'; event_kind := 'source_changed';
      end if;
      c.source_due_on := s.follow_up_date; c.source_done := s.follow_up_done;
      c.source_counselor_id := s.counselor_id; c.assignee_id := owner_id;
    end if;
    if active_mode and not c.announced and c.status not in ('resolved','dismissed') then
      c.announced := true; event_kind := coalesce(event_kind,'activated');
    end if;
    if event_kind is null and active_mode and c.status in ('open','in_progress','waiting_review')
      and coalesce(c.next_check_on,c.source_due_on) <= today
      and (now() - coalesce(c.acknowledged_at,c.created_at)) >= make_interval(days => ack_days)
      and (c.last_reminded_on is null or c.last_reminded_on <= today - reminder_days) then
      c.last_reminded_on := today; event_kind := 'reminded';
    end if;
    if event_kind is not null then c.version := c.version + 1; c.updated_at := now(); end if;
    update public.management_cases set
      status=c.status, episode=c.episode, version=c.version, source_due_on=c.source_due_on,
      source_done=c.source_done, source_counselor_id=c.source_counselor_id, assignee_id=c.assignee_id,
      result_kind=c.result_kind, result_note=c.result_note, verification_note=c.verification_note,
      acknowledged_at=c.acknowledged_at, next_check_on=c.next_check_on, last_reminded_on=c.last_reminded_on,
      announced=c.announced, last_checked_at=now(), updated_at=c.updated_at
      where id=c.id and tenant_id=p_tenant;
    if event_kind is not null then perform public.management_case_event(c,event_kind); changed := changed + 1; end if;
  end loop;
  return changed;
end;
$$;
revoke all on function public.management_agent_scan(uuid,uuid) from public, anon, authenticated;
grant execute on function public.management_agent_scan(uuid,uuid) to service_role;
commit;
