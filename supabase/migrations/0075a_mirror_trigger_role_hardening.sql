-- =============================================================================
-- 0075a_mirror_trigger_role_hardening.sql
--
-- Hardens the auth.users -> public.users mirror trigger (tg_sync_user_from_auth,
-- originally 0001a) so a metadata-only auth update never silently DOWNGRADES an
-- existing user's role.
--
-- BACKGROUND (2026-07-01, production tenant injaewon):
--   admin.updateUserById for a password reset / ban / email change fires this
--   trigger via `update of raw_app_meta_data`. The old ON CONFLICT branch did
--   `system_role = excluded.system_role`, where excluded.system_role folds in a
--   'viewer' fallback (coalesce(app_metadata.system_role, 'viewer')). So any auth
--   update whose app_metadata lacked/held a stale system_role rewrote
--   public.users.system_role — quietly demoting imported teachers to viewer
--   (observed: 이수연/kelly, then 8 more imported teachers).
--
-- FIX: on conflict, take the role from app_metadata ONLY when it is EXPLICITLY
--   present; otherwise preserve the existing (authoritative) public.users role.
--   The INSERT (new-account) path is unchanged: still defaults to 'viewer' when
--   no explicit role is supplied.
--
-- REGRESSION SAFETY: every deliberate role-change path (createStaff,
--   super-admin createTenantWithMaster, changeStaffRole, changeUserRole) passes
--   an EXPLICIT app_metadata.system_role, so v_role_explicit is non-null and the
--   trigger still applies the intended role — identical to the old behavior for
--   those flows. Only metadata-only updates (no explicit role) change: they now
--   preserve the current role instead of resetting it to viewer.
--
-- Idempotent: pure `create or replace function`. No data change here — the
-- one-time app_metadata correction for the 8 drifted teachers is applied
-- separately through the auth admin API.
-- =============================================================================

create or replace function public.tg_sync_user_from_auth() returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tenant        uuid;
  v_role_explicit public.system_role;  -- role from app_metadata iff explicitly present, else NULL
  v_name          text;
begin
  v_tenant := nullif(new.raw_app_meta_data ->> 'tenant_id', '')::uuid;
  -- Do NOT fold in a 'viewer' fallback here: we must be able to tell "no role
  -- supplied" (NULL) apart from an explicit role, so the conflict branch can
  -- preserve the existing role rather than clobber it.
  v_role_explicit := nullif(new.raw_app_meta_data ->> 'system_role', '')::public.system_role;
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1)
  );

  if v_tenant is null then
    return new;
  end if;

  insert into public.users (id, tenant_id, email, display_name, system_role, status)
  values (
    new.id,
    v_tenant,
    new.email,
    v_name,
    coalesce(v_role_explicit, 'viewer'::public.system_role),  -- new accounts: default viewer
    'active'
  )
  on conflict (id) do update set
    tenant_id    = excluded.tenant_id,
    email        = excluded.email,
    display_name = coalesce(public.users.display_name, excluded.display_name),
    -- Role hardening: only adopt an EXPLICIT app_metadata role; otherwise keep
    -- the existing (authoritative) public.users role. Prevents metadata-only
    -- auth updates (password reset / ban / email change) from demoting a user.
    system_role  = coalesce(v_role_explicit, public.users.system_role);

  return new;
end;
$$;

-- Trigger binding is unchanged (still fires AFTER INSERT OR UPDATE OF email,
-- raw_app_meta_data, raw_user_meta_data). Re-created here for idempotent setup
-- on fresh databases where 0001a may not yet be applied in this exact order.
drop trigger if exists tg_on_auth_user_change on auth.users;
create trigger tg_on_auth_user_change
  after insert or update of email, raw_app_meta_data, raw_user_meta_data
  on auth.users
  for each row execute function public.tg_sync_user_from_auth();
