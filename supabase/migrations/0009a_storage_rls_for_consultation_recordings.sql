-- Storage RLS for the consultation-recordings bucket.
-- Path convention: {tenant_id}/{uuid}.{ext} (same as meeting-recordings).
-- Service role bypasses RLS — used by the AssemblyAI webhook handler.

drop policy if exists cr_tenant_insert on storage.objects;
create policy cr_tenant_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'consultation-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists cr_tenant_select on storage.objects;
create policy cr_tenant_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'consultation-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists cr_tenant_update on storage.objects;
create policy cr_tenant_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'consultation-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  )
  with check (
    bucket_id = 'consultation-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );

drop policy if exists cr_tenant_delete on storage.objects;
create policy cr_tenant_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'consultation-recordings'
    and (string_to_array(name, '/'))[1] = public.auth_tenant_id()::text
  );
