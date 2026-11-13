-- Remove an event from active lists while preserving its source and student links for restoration.
alter table public.marketing_archive_events add column if not exists deleted_at timestamptz;

create or replace function public.save_marketing_archive(p_tenant uuid,p_actor uuid,p_kind text,p_id uuid,p_version integer,p_document jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare result_id uuid; new_version integer; event_id_value uuid; student_id_value uuid; title_date text; d text;
begin
 if not exists(select 1 from public.users where id=p_actor and tenant_id=p_tenant and status='active' and system_role in ('master','admin')) then raise exception 'archive_access_denied'; end if;
 if p_tenant <> 'becaa316-e636-42e9-9d09-08b133e0b094'::uuid then raise exception 'archive_access_denied'; end if;
 if p_kind='event' then
   if length(trim(coalesce(p_document->>'title','')))=0 then raise exception 'invalid_event'; end if;
   d:=p_document->>'date';
   if p_document->>'state'='held' then
     if d is null or d::date>(now() at time zone 'Asia/Seoul')::date then raise exception 'invalid_event_date'; end if;
     if p_document->>'title' ~ '^2[0-9][01][0-9][0-3][0-9]' then
       title_date:='20'||substr(p_document->>'title',1,2)||'-'||substr(p_document->>'title',3,2)||'-'||substr(p_document->>'title',5,2);
       if title_date<>d and length(trim(coalesce(p_document->>'dateResolution','')))=0 then raise exception 'date_conflict'; end if;
     end if;
   end if;
   if p_document->>'actualCost' is not null and length(trim(coalesce(p_document->>'costReference','')))=0 then raise exception 'missing_cost_reference'; end if;
   if p_document->>'referenceEventId' is not null and not exists(select 1 from public.marketing_archive_events where tenant_id=p_tenant and id=(p_document->>'referenceEventId')::uuid) then raise exception 'invalid_reference'; end if;
   if p_document->>'ownerId' is not null and not exists(select 1 from public.users where tenant_id=p_tenant and id=(p_document->>'ownerId')::uuid and status='active') then raise exception 'invalid_owner'; end if;
   if p_id is null then
     insert into public.marketing_archive_events(tenant_id,document,updated_by) values(p_tenant,p_document,p_actor) returning id,version into result_id,new_version;
   else
     update public.marketing_archive_events set document=p_document,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id and tenant_id=p_tenant and version=p_version and deleted_at is null returning id,version into result_id,new_version;
   end if;
 elsif p_kind='event_visibility' then
   if jsonb_typeof(p_document->'deleted') is distinct from 'boolean' then raise exception 'invalid_visibility'; end if;
   update public.marketing_archive_events
   set deleted_at=case when (p_document->>'deleted')::boolean then now() else null end,
       version=version+1,updated_by=p_actor,updated_at=now()
   where id=p_id and tenant_id=p_tenant and version=p_version
     and (deleted_at is null)=(p_document->>'deleted')::boolean
   returning id,version into result_id,new_version;
 elsif p_kind='student' then
   event_id_value:=(p_document->>'eventId')::uuid; student_id_value:=(p_document->>'studentId')::uuid;
   if not exists(select 1 from public.marketing_archive_events where tenant_id=p_tenant and id=event_id_value and deleted_at is null for share) or not exists(select 1 from public.students where tenant_id=p_tenant and id=student_id_value and not coalesce(is_test,false)) then raise exception 'invalid_student_event'; end if;
   if p_id is null then
     insert into public.marketing_archive_students(tenant_id,event_id,student_id,document,updated_by) values(p_tenant,event_id_value,student_id_value,p_document,p_actor) returning id,version into result_id,new_version;
   else
     update public.marketing_archive_students set document=p_document,event_id=event_id_value,student_id=student_id_value,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id and tenant_id=p_tenant and version=p_version returning id,version into result_id,new_version;
   end if;
 elsif p_kind='source' then
   event_id_value:=nullif(p_document->>'eventId','')::uuid;
   if event_id_value is not null and not exists(select 1 from public.marketing_archive_events where id=event_id_value and tenant_id=p_tenant and deleted_at is null for share) then raise exception 'invalid_reference'; end if;
   update public.marketing_source_inbox set review_status=p_document->>'status',review_note=p_document->>'note',version=version+1 where id=p_id and tenant_id=p_tenant and version=p_version returning id,version into result_id,new_version;
   if result_id is not null and event_id_value is not null then insert into public.marketing_archive_sources values(p_tenant,event_id_value,p_id) on conflict do nothing; end if;
 else raise exception 'invalid_kind';
 end if;
 if result_id is null then raise exception 'archive_version_conflict'; end if;
 insert into public.marketing_archive_audit(tenant_id,actor_id,entity_id,kind,document,version) values(p_tenant,p_actor,result_id,p_kind,p_document,new_version);
 return jsonb_build_object('id',result_id,'version',new_version);
end $$;
revoke all on function public.save_marketing_archive(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_marketing_archive(uuid,uuid,text,uuid,integer,jsonb) to service_role;
notify pgrst,'reload schema';
