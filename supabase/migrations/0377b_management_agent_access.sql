begin;
-- No application-supplied identity. Source counselor remains the scope boundary.
create or replace function public.management_case_readable(p_tenant uuid, p_consultation uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_tenant = public.auth_tenant_id()
    and exists (select 1 from public.users u where u.id = auth.uid() and u.status = 'active')
    and (public.auth_menu_access('consultations') in ('full','readonly')
      or (public.auth_menu_access('consultations') = 'scoped' and exists (
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
