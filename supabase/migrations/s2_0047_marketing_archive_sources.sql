-- Private archive workspace. Browser roles cannot query these tables or call the mutation RPC.
create table public.marketing_archive_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 source_key text, document jsonb not null, version integer not null default 1 check(version>0),
 updated_by uuid references public.users(id), updated_at timestamptz not null default now(),
 unique(tenant_id,source_key), unique(tenant_id,id)
);
create table public.marketing_source_inbox (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 source_key text not null, document jsonb not null, review_status text not null default 'review' check(review_status in ('review','reference','excluded','linked')),
 review_note text, version integer not null default 1, ingested_at timestamptz not null default now(),
 unique(tenant_id,source_key), unique(tenant_id,id)
);
create table public.marketing_archive_sources (
 tenant_id uuid not null, event_id uuid not null, source_id uuid not null,
 primary key(tenant_id,event_id,source_id),
 foreign key(tenant_id,event_id) references public.marketing_archive_events(tenant_id,id),
 foreign key(tenant_id,source_id) references public.marketing_source_inbox(tenant_id,id)
);
create index marketing_archive_sources_source on public.marketing_archive_sources(tenant_id,source_id);
create table public.marketing_archive_students (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 event_id uuid not null, student_id uuid not null references public.students(id), document jsonb not null,
 version integer not null default 1, updated_by uuid not null references public.users(id), updated_at timestamptz not null default now(),
 foreign key(tenant_id,event_id) references public.marketing_archive_events(tenant_id,id)
);
create unique index marketing_archive_students_touch on public.marketing_archive_students(tenant_id,event_id,student_id,(document->>'kind'),(document->>'date'));
create index marketing_archive_students_student on public.marketing_archive_students(tenant_id,student_id);
create index marketing_archive_events_date on public.marketing_archive_events(tenant_id,(document->>'date'));
create table public.marketing_archive_audit (
 id bigint generated always as identity primary key, tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.users(id), entity_id uuid not null, kind text not null,
 document jsonb not null, version integer not null, created_at timestamptz not null default now()
);
create index marketing_archive_audit_tenant on public.marketing_archive_audit(tenant_id,created_at);
alter table public.marketing_archive_events enable row level security;
alter table public.marketing_source_inbox enable row level security;
alter table public.marketing_archive_sources enable row level security;
alter table public.marketing_archive_students enable row level security;
alter table public.marketing_archive_audit enable row level security;
revoke all on public.marketing_archive_events,public.marketing_source_inbox,public.marketing_archive_sources,public.marketing_archive_students,public.marketing_archive_audit from anon,authenticated;
grant all on public.marketing_archive_events,public.marketing_source_inbox,public.marketing_archive_sources,public.marketing_archive_students,public.marketing_archive_audit to service_role;
grant usage,select on sequence public.marketing_archive_audit_id_seq to service_role;

create function public.save_marketing_archive(p_tenant uuid,p_actor uuid,p_kind text,p_id uuid,p_version integer,p_document jsonb)
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
     update public.marketing_archive_events set document=p_document,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id and tenant_id=p_tenant and version=p_version returning id,version into result_id,new_version;
   end if;
 elsif p_kind='student' then
   event_id_value:=(p_document->>'eventId')::uuid; student_id_value:=(p_document->>'studentId')::uuid;
   if not exists(select 1 from public.marketing_archive_events where tenant_id=p_tenant and id=event_id_value) or not exists(select 1 from public.students where tenant_id=p_tenant and id=student_id_value and not coalesce(is_test,false)) then raise exception 'invalid_student_event'; end if;
   if p_id is null then
     insert into public.marketing_archive_students(tenant_id,event_id,student_id,document,updated_by) values(p_tenant,event_id_value,student_id_value,p_document,p_actor) returning id,version into result_id,new_version;
   else
     update public.marketing_archive_students set document=p_document,event_id=event_id_value,student_id=student_id_value,version=version+1,updated_by=p_actor,updated_at=now() where id=p_id and tenant_id=p_tenant and version=p_version returning id,version into result_id,new_version;
   end if;
 elsif p_kind='source' then
   event_id_value:=nullif(p_document->>'eventId','')::uuid;
   if event_id_value is not null and not exists(select 1 from public.marketing_archive_events where id=event_id_value and tenant_id=p_tenant) then raise exception 'invalid_reference'; end if;
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
