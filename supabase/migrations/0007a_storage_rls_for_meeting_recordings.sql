-- Storage RLS for the meeting-recordings bucket.
-- Path convention: {tenant_id}/{meeting_id}/{filename}
-- The leading segment is the tenant UUID, so we gate every operation by matching
-- it against auth_tenant_id(). Service role (used by the webhook) bypasses RLS.

drop policy if exists mr_tenant_insert on storage.objects;
create policy mr_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists mr_tenant_select on storage.objects;
create policy mr_tenant_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists mr_tenant_update on storage.objects;
create policy mr_tenant_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  )
  with check (
    bucket_id = 'meeting-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists mr_tenant_delete on storage.objects;
create policy mr_tenant_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meeting-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );
