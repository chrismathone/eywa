-- Existing PUBLIC RLS policies are evaluated alongside the agent policy. Their
-- helpers need EXECUTE even when the JWT user lookup returns NULL. Keep the
-- restrictive agent tenant/FK policy and the non-inheriting role unchanged.
do $$
begin
  execute 'grant execute on function public.auth_tenant_id() to eywa_sync_agent';
  execute 'grant execute on function public.auth_system_role() to eywa_sync_agent';
end
$$;
