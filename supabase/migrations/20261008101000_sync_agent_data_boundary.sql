-- No existing user policy is changed. New role has no login and is used only inside gateway transactions.
do $$ begin
  if not exists(select from pg_roles where rolname='eywa_sync_agent') then create role eywa_sync_agent nologin noinherit; end if;
  execute format('grant eywa_sync_agent to %I',current_user);
end $$;
grant usage on schema public to eywa_sync_agent;

-- Check tenant-bearing FK targets as well as the row itself. A device cannot attach
-- its own row to a student, teacher, invoice or class belonging to another tenant.
create function public.sync_agent_foreign_keys(p_table regclass,p_row jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare fk record; pair record; pred text; target_tenant text; permitted boolean;
begin
  for fk in select oid,confrelid,conkey,confkey from pg_constraint where conrelid=p_table and contype='f' loop
    select case when fk.confrelid='public.tenants'::regclass then 'id' else 'tenant_id' end into target_tenant;
    if not exists(select from pg_attribute where attrelid=fk.confrelid and attname=target_tenant and not attisdropped) then continue; end if;
    pred:='';
    for pair in
      select a.attname src,b.attname dst from unnest(fk.conkey,fk.confkey) k(src,dst)
      join pg_attribute a on a.attrelid=p_table and a.attnum=k.src
      join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.dst
    loop
      if p_row->>pair.src is null then pred:=null; exit; end if;
      pred:=pred || format(' and to_jsonb(t)->>%L = $1->>%L',pair.dst,pair.src);
    end loop;
    if pred is null then continue; end if;
    execute format('select exists(select from %s t where t.%I = nullif(current_setting(''eywa.agent_tenant'',true),'''')::uuid %s)',fk.confrelid::regclass,target_tenant,pred)
      into permitted using p_row;
    if not permitted then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.sync_agent_foreign_keys(regclass,jsonb) from public,anon,authenticated;
grant execute on function public.sync_agent_foreign_keys(regclass,jsonb) to eywa_sync_agent;

alter table public.audit_logs enable row level security;
grant select,insert,update,delete on public.audit_logs to eywa_sync_agent;
create policy sync_agent_allow on public.audit_logs for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.audit_logs as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.audit_logs'::regclass,to_jsonb(audit_logs)));

alter table public.class_delegations enable row level security;
grant select,insert,update,delete on public.class_delegations to eywa_sync_agent;
create policy sync_agent_allow on public.class_delegations for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.class_delegations as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.class_delegations'::regclass,to_jsonb(class_delegations)));

alter table public.class_schedules enable row level security;
grant select,insert,update,delete on public.class_schedules to eywa_sync_agent;
create policy sync_agent_allow on public.class_schedules for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.class_schedules as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.class_schedules'::regclass,to_jsonb(class_schedules)));

alter table public.classes enable row level security;
grant select,insert,update,delete on public.classes to eywa_sync_agent;
create policy sync_agent_allow on public.classes for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classes as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classes'::regclass,to_jsonb(classes)));

alter table public.classnote_board_members enable row level security;
grant select,insert,update,delete on public.classnote_board_members to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_board_members for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_board_members as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_board_members'::regclass,to_jsonb(classnote_board_members)));

alter table public.classnote_board_sync_runs enable row level security;
grant select,insert,update,delete on public.classnote_board_sync_runs to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_board_sync_runs for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_board_sync_runs as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_board_sync_runs'::regclass,to_jsonb(classnote_board_sync_runs)));

alter table public.classnote_boards enable row level security;
grant select,insert,update,delete on public.classnote_boards to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_boards for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_boards as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_boards'::regclass,to_jsonb(classnote_boards)));

alter table public.classnote_child_links enable row level security;
grant select,insert,update,delete on public.classnote_child_links to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_child_links for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_child_links as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_child_links'::regclass,to_jsonb(classnote_child_links)));

alter table public.classnote_class_board_members enable row level security;
grant select,insert,update,delete on public.classnote_class_board_members to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_class_board_members for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_class_board_members as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_class_board_members'::regclass,to_jsonb(classnote_class_board_members)));

alter table public.classnote_class_boards enable row level security;
grant select,insert,update,delete on public.classnote_class_boards to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_class_boards for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_class_boards as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_class_boards'::regclass,to_jsonb(classnote_class_boards)));

alter table public.classnote_class_notices enable row level security;
grant select,insert,update,delete on public.classnote_class_notices to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_class_notices for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_class_notices as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_class_notices'::regclass,to_jsonb(classnote_class_notices)));

alter table public.classnote_class_posts enable row level security;
grant select,insert,update,delete on public.classnote_class_posts to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_class_posts for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_class_posts as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_class_posts'::regclass,to_jsonb(classnote_class_posts)));

alter table public.classnote_feed_state enable row level security;
grant select,insert,update,delete on public.classnote_feed_state to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_feed_state for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_feed_state as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_feed_state'::regclass,to_jsonb(classnote_feed_state)));

alter table public.classnote_notices enable row level security;
grant select,insert,update,delete on public.classnote_notices to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_notices for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_notices as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_notices'::regclass,to_jsonb(classnote_notices)));

alter table public.classnote_parent_message_attachments enable row level security;
grant select,insert,update,delete on public.classnote_parent_message_attachments to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_parent_message_attachments for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_parent_message_attachments as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_parent_message_attachments'::regclass,to_jsonb(classnote_parent_message_attachments)));

alter table public.classnote_parent_messages enable row level security;
grant select,insert,update,delete on public.classnote_parent_messages to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_parent_messages for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_parent_messages as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_parent_messages'::regclass,to_jsonb(classnote_parent_messages)));

alter table public.classnote_parent_reactions enable row level security;
grant select,insert,update,delete on public.classnote_parent_reactions to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_parent_reactions for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_parent_reactions as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_parent_reactions'::regclass,to_jsonb(classnote_parent_reactions)));

alter table public.classnote_parent_replies enable row level security;
grant select,insert,update,delete on public.classnote_parent_replies to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_parent_replies for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_parent_replies as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_parent_replies'::regclass,to_jsonb(classnote_parent_replies)));

alter table public.classnote_student_links enable row level security;
grant select,insert,update,delete on public.classnote_student_links to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_student_links for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_student_links as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_student_links'::regclass,to_jsonb(classnote_student_links)));

alter table public.classnote_sync_requests enable row level security;
grant select,insert,update,delete on public.classnote_sync_requests to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_sync_requests for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_sync_requests as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_sync_requests'::regclass,to_jsonb(classnote_sync_requests)));

alter table public.classnote_video_files enable row level security;
grant select,insert,update,delete on public.classnote_video_files to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_video_files for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_video_files as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_video_files'::regclass,to_jsonb(classnote_video_files)));

alter table public.classnote_video_folders enable row level security;
grant select,insert,update,delete on public.classnote_video_folders to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_video_folders for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_video_folders as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_video_folders'::regclass,to_jsonb(classnote_video_folders)));

alter table public.classnote_video_history enable row level security;
grant select,insert,update,delete on public.classnote_video_history to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_video_history for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_video_history as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_video_history'::regclass,to_jsonb(classnote_video_history)));

alter table public.classnote_workers enable row level security;
grant select,insert,update,delete on public.classnote_workers to eywa_sync_agent;
create policy sync_agent_allow on public.classnote_workers for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.classnote_workers as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.classnote_workers'::regclass,to_jsonb(classnote_workers)));

alter table public.enrollment_consultations enable row level security;
grant select,insert,update,delete on public.enrollment_consultations to eywa_sync_agent;
create policy sync_agent_allow on public.enrollment_consultations for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.enrollment_consultations as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.enrollment_consultations'::regclass,to_jsonb(enrollment_consultations)));

alter table public.enrollments enable row level security;
grant select,insert,update,delete on public.enrollments to eywa_sync_agent;
create policy sync_agent_allow on public.enrollments for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.enrollments as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.enrollments'::regclass,to_jsonb(enrollments)));

alter table public.homework_video_drive_connections enable row level security;
grant select,insert,update,delete on public.homework_video_drive_connections to eywa_sync_agent;
create policy sync_agent_allow on public.homework_video_drive_connections for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.homework_video_drive_connections as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.homework_video_drive_connections'::regclass,to_jsonb(homework_video_drive_connections)));

alter table public.homework_video_drive_roots enable row level security;
grant select,insert,update,delete on public.homework_video_drive_roots to eywa_sync_agent;
create policy sync_agent_allow on public.homework_video_drive_roots for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.homework_video_drive_roots as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.homework_video_drive_roots'::regclass,to_jsonb(homework_video_drive_roots)));

alter table public.homework_video_drive_settings enable row level security;
grant select,insert,update,delete on public.homework_video_drive_settings to eywa_sync_agent;
create policy sync_agent_allow on public.homework_video_drive_settings for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.homework_video_drive_settings as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.homework_video_drive_settings'::regclass,to_jsonb(homework_video_drive_settings)));

alter table public.invoices enable row level security;
grant select,insert,update,delete on public.invoices to eywa_sync_agent;
create policy sync_agent_allow on public.invoices for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.invoices as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.invoices'::regclass,to_jsonb(invoices)));

alter table public.lesson_reports enable row level security;
grant select,insert,update,delete on public.lesson_reports to eywa_sync_agent;
create policy sync_agent_allow on public.lesson_reports for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.lesson_reports as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.lesson_reports'::regclass,to_jsonb(lesson_reports)));

alter table public.makeedu_push_batches enable row level security;
grant select,insert,update,delete on public.makeedu_push_batches to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_push_batches for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_push_batches as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_push_batches'::regclass,to_jsonb(makeedu_push_batches)));

alter table public.makeedu_push_requests enable row level security;
grant select,insert,update,delete on public.makeedu_push_requests to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_push_requests for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_push_requests as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_push_requests'::regclass,to_jsonb(makeedu_push_requests)));

alter table public.makeedu_sync_requests enable row level security;
grant select,insert,update,delete on public.makeedu_sync_requests to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_sync_requests for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_sync_requests as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_sync_requests'::regclass,to_jsonb(makeedu_sync_requests)));

alter table public.makeedu_sync_runs enable row level security;
grant select,insert,update,delete on public.makeedu_sync_runs to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_sync_runs for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_sync_runs as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_sync_runs'::regclass,to_jsonb(makeedu_sync_runs)));

alter table public.makeedu_sync_state enable row level security;
grant select,insert,update,delete on public.makeedu_sync_state to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_sync_state for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_sync_state as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_sync_state'::regclass,to_jsonb(makeedu_sync_state)));

alter table public.makeedu_sync_workers enable row level security;
grant select,insert,update,delete on public.makeedu_sync_workers to eywa_sync_agent;
create policy sync_agent_allow on public.makeedu_sync_workers for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.makeedu_sync_workers as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.makeedu_sync_workers'::regclass,to_jsonb(makeedu_sync_workers)));

alter table public.notification_events enable row level security;
grant select,insert,update,delete on public.notification_events to eywa_sync_agent;
create policy sync_agent_allow on public.notification_events for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.notification_events as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.notification_events'::regclass,to_jsonb(notification_events)));

alter table public.notifications enable row level security;
grant select,insert,update,delete on public.notifications to eywa_sync_agent;
create policy sync_agent_allow on public.notifications for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.notifications as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.notifications'::regclass,to_jsonb(notifications)));

alter table public.student_consultations enable row level security;
grant select,insert,update,delete on public.student_consultations to eywa_sync_agent;
create policy sync_agent_allow on public.student_consultations for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.student_consultations as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.student_consultations'::regclass,to_jsonb(student_consultations)));

alter table public.student_homework_videos enable row level security;
grant select,insert,update,delete on public.student_homework_videos to eywa_sync_agent;
create policy sync_agent_allow on public.student_homework_videos for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.student_homework_videos as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.student_homework_videos'::regclass,to_jsonb(student_homework_videos)));

alter table public.students enable row level security;
grant select,insert,update,delete on public.students to eywa_sync_agent;
create policy sync_agent_allow on public.students for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.students as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.students'::regclass,to_jsonb(students)));

alter table public.tenant_settings enable row level security;
grant select,insert,update,delete on public.tenant_settings to eywa_sync_agent;
create policy sync_agent_allow on public.tenant_settings for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.tenant_settings as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.tenant_settings'::regclass,to_jsonb(tenant_settings)));

alter table public.tenants enable row level security;
grant select,insert,update,delete on public.tenants to eywa_sync_agent;
create policy sync_agent_allow on public.tenants for all to eywa_sync_agent using (id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.tenants as restrictive for all to eywa_sync_agent
  using (id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.tenants'::regclass,to_jsonb(tenants)));

alter table public.textbook_orders enable row level security;
grant select,insert,update,delete on public.textbook_orders to eywa_sync_agent;
create policy sync_agent_allow on public.textbook_orders for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.textbook_orders as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.textbook_orders'::regclass,to_jsonb(textbook_orders)));

alter table public.user_integrations enable row level security;
grant select,insert,update,delete on public.user_integrations to eywa_sync_agent;
create policy sync_agent_allow on public.user_integrations for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.user_integrations as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.user_integrations'::regclass,to_jsonb(user_integrations)));

alter table public.users enable row level security;
grant select,insert,update,delete on public.users to eywa_sync_agent;
create policy sync_agent_allow on public.users for all to eywa_sync_agent using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid);
create policy sync_agent_tenant_boundary on public.users as restrictive for all to eywa_sync_agent
  using (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid) with check (tenant_id=nullif(current_setting('eywa.agent_tenant',true),'')::uuid and public.sync_agent_foreign_keys('public.users'::regclass,to_jsonb(users)));
