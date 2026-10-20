begin;
alter table public.management_notion_outbox add column creation_started boolean not null default false;
grant select on public.management_notion_outbox to authenticated;
create policy management_notion_read on public.management_notion_outbox for select to authenticated
  using (tenant_id=public.auth_tenant_id() and (select public.auth_menu_access('consultations'))='full');

-- One external writer per academy; crashed sends are reconciled before any new creation.
create or replace function public.management_notion_claim(p_tenant uuid)
returns setof public.management_notion_outbox language plpgsql security definer set search_path=public as $$
declare picked uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('management-notion:' || p_tenant,0)) then return; end if;
  if exists(select 1 from public.management_notion_outbox where tenant_id=p_tenant
    and status='sending' and updated_at > now()-interval '2 minutes') then return; end if;
  select id into picked from public.management_notion_outbox where tenant_id=p_tenant and
    (status='pending' or (status in ('failed','uncertain','sending') and updated_at < now()-interval '10 minutes'))
    order by updated_at,id limit 1 for update skip locked;
  return query update public.management_notion_outbox set status='sending',attempts=attempts+1,updated_at=now()
    where id=picked and tenant_id=p_tenant returning *;
end;
$$;
revoke all on function public.management_notion_claim(uuid) from public,anon,authenticated;
grant execute on function public.management_notion_claim(uuid) to service_role;

create or replace function public.management_case_save_advice(p_id uuid,p_version integer,p_advice jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.management_cases; lvl text;
begin
  select * into c from public.management_cases where id=p_id and tenant_id=public.auth_tenant_id() for update;
  if not found or not exists(select 1 from public.users where id=auth.uid() and tenant_id=c.tenant_id and status='active') then
    raise exception using errcode='42501',message='처리 권한이 없습니다'; end if;
  lvl := public.auth_menu_access('consultations');
  if coalesce(lvl,'none') not in ('full','scoped') or not public.management_case_readable(c.tenant_id,c.consultation_id) then
    raise exception using errcode='42501',message='처리 권한이 없습니다'; end if;
  if not exists(select 1 from public.tenant_settings where tenant_id=c.tenant_id
    and data #>> '{notifications,managementAgent,mode}' in ('observe','active')) then
    raise exception '후속조치 관리가 꺼져 있습니다'; end if;
  if p_version is distinct from c.version then raise exception '대응안 작성 중 기록이 바뀌었습니다. 다시 확인해 주세요'; end if;
  if jsonb_typeof(p_advice) is distinct from 'object' or length(p_advice::text)>4000
    or jsonb_typeof(p_advice->'summary') is distinct from 'string'
    or jsonb_typeof(p_advice->'actions') is distinct from 'array'
    or jsonb_typeof(p_advice->'verification') is distinct from 'string' then raise exception '대응안 형식을 확인해 주세요'; end if;
  if length(btrim(p_advice->>'summary')) not between 1 and 400
    or length(btrim(p_advice->>'verification')) not between 1 and 400
    or jsonb_array_length(p_advice->'actions') not between 1 and 3
    or exists(select 1 from jsonb_array_elements(p_advice->'actions') a
      where jsonb_typeof(a) is distinct from 'string' or length(btrim(a #>> '{}')) not between 1 and 200)
    then raise exception '대응안 형식을 확인해 주세요'; end if;
  update public.management_cases set ai_advice=p_advice,ai_version=c.version where id=c.id and tenant_id=c.tenant_id;
  perform public.management_case_event(c,'advice',auth.uid());
end;
$$;
revoke all on function public.management_case_save_advice(uuid,integer,jsonb) from public,anon;
grant execute on function public.management_case_save_advice(uuid,integer,jsonb) to authenticated;
commit;
