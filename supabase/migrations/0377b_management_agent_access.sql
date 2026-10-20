begin;
-- The shared auth_menu_access catalogue covers finance/staff, not consultations.
-- Keep this pilot's permission check local; mirror consultations defaults and last-valid override order.
-- No caller-supplied role/tenant; inactive users and a mismatched tenant view fail closed.
create or replace function public.management_agent_access()
returns text language plpgsql stable security definer set search_path = public as $$
declare actor_role text; cfg jsonb; level text;
begin
  select u.system_role::text into actor_role from public.users u
    where u.id = auth.uid() and u.tenant_id = public.auth_tenant_id() and u.status = 'active';
  -- Student menus are locked even if malformed stored overrides attempt a grant.
  if actor_role is null or actor_role not in ('master','admin','manager','teacher','counselor','accountant','viewer') then return 'none'; end if;
  select ts.data->'permissions' into cfg from public.tenant_settings ts where ts.tenant_id = public.auth_tenant_id();
  select o.value->>'access' into level
    from jsonb_array_elements(coalesce(cfg->'userOverrides','[]'::jsonb)) with ordinality o(value, position)
    where o.value->>'menu' = 'consultations' and o.value->>'userId' = auth.uid()::text
      and o.value->>'access' in ('none','readonly','scoped','full')
    order by o.position desc limit 1;
  if level is not null then return level; end if;
  select o.value->>'access' into level
    from jsonb_array_elements(coalesce(cfg->'overrides','[]'::jsonb)) with ordinality o(value, position)
    where o.value->>'menu' = 'consultations' and o.value->>'role' = actor_role
      and o.value->>'access' in ('none','readonly','scoped','full')
    order by o.position desc limit 1;
  return coalesce(level, ('{"master":"full","admin":"full","manager":"full","teacher":"scoped","counselor":"full","accountant":"none","viewer":"readonly","student":"none"}'::jsonb)->>actor_role, 'none');
end;
$$;
revoke all on function public.management_agent_access() from public, anon;
grant execute on function public.management_agent_access() to authenticated, service_role;

-- No application-supplied identity. Source counselor remains the scope boundary.
create or replace function public.management_case_readable(p_tenant uuid, p_consultation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tenant = public.auth_tenant_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.status = 'active')
    and (public.management_agent_access() in ('full','readonly')
      or (public.management_agent_access() = 'scoped' and exists (
        select 1 from public.student_consultations s where s.id = p_consultation
          and s.tenant_id = p_tenant and s.counselor_id = auth.uid())));
$$;
revoke all on function public.management_case_readable(uuid,uuid) from public, anon;
grant execute on function public.management_case_readable(uuid,uuid) to authenticated, service_role;
create policy management_cases_read on public.management_cases for select to authenticated
  using (public.management_case_readable(tenant_id, consultation_id));
create policy management_case_events_read on public.management_case_events for select to authenticated
  using (tenant_id = public.auth_tenant_id() and exists (
    select 1 from public.management_cases c where c.id = case_id and c.tenant_id = management_case_events.tenant_id));

-- Events + notification source rows commit together; existing Slack inbox/outbox handles delivery.
create or replace function public.management_case_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.management_cases; cfg jsonb; recipient uuid; caption text;
begin
  select * into c from public.management_cases where id = new.case_id and tenant_id = new.tenant_id;
  select data #> '{notifications,managementAgent}' into cfg from public.tenant_settings where tenant_id = new.tenant_id;
  if coalesce(cfg->>'mode','off') <> 'active' or new.kind in ('acknowledged','advice') then return new; end if;
  caption := case new.kind when 'verified' then '상담 후속조치 확인 완료'
    when 'submitted' then '상담 처리 결과 확인 필요' when 'reminded' then '상담 후속조치 지연 확인'
    when 'source_missing' then '상담 원본 확인 필요' when 'dismissed' then '상담 조치 불필요 확인'
    else '상담 후속조치 확인 요청' end;
  for recipient in
    select u.id from public.users u where u.tenant_id = new.tenant_id and u.status = 'active'
      and (u.system_role = 'master' or (u.id = c.assignee_id and new.kind <> 'submitted'))
  loop
    insert into public.notifications(tenant_id, recipient_id, type, title, body, link, actor_id)
    values(new.tenant_id, recipient, 'management_followup', caption,
      '에이와에서 담당 업무와 처리 결과를 확인해 주세요. 사건 ' || left(c.id::text,8),
      '/consultations/followups/' || c.id, new.actor_id);
  end loop;
  if coalesce((cfg->>'notionAlerts')::boolean,false) then
    insert into public.management_notion_outbox(tenant_id,case_id,version)
      values(c.tenant_id,c.id,c.version) on conflict (tenant_id,case_id) do update
      set version=excluded.version,
        status=case when management_notion_outbox.status='sending' then 'sending' else 'pending' end;
  end if;
  return new;
end;
$$;
revoke all on function public.management_case_notify() from public, anon, authenticated;
create trigger management_case_notify after insert on public.management_case_events
  for each row execute function public.management_case_notify();
commit;
