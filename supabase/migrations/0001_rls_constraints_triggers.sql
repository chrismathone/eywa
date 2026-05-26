-- =============================================================================
-- 0001_rls_constraints_triggers.sql
--
-- Layered on top of the Drizzle-generated 0000 migration:
--   A. Postgres extensions we depend on
--   B. auth_tenant_id() resolver (used by every RLS policy)
--   C. updated_at auto-bump trigger + attachments
--   D. students.name_normalized generated column + partial unique index
--   E. enrollments daterange overlap blocker (GiST EXCLUDE)
--   F. auth.users -> public.users sync trigger + backfill
--   G. RLS enable + tenant isolation policies for every tenant-scoped table
-- =============================================================================

-- A. Extensions ---------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists btree_gist;

-- B. Tenant resolver ----------------------------------------------------------
-- SECURITY DEFINER lets the function read public.users while bypassing RLS,
-- which is required because the user's own row is what determines their tenant.
create or replace function public.auth_tenant_id() returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select tenant_id from public.users where id = auth.uid()
$$;

revoke all on function public.auth_tenant_id() from public;
grant execute on function public.auth_tenant_id() to authenticated, service_role;

-- C. updated_at trigger -------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.tg_set_updated_at();

drop trigger if exists students_set_updated_at on public.students;
create trigger students_set_updated_at
  before update on public.students
  for each row execute function public.tg_set_updated_at();

drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.tg_set_updated_at();

-- D. students.name_normalized + active-only natural-key uniqueness ------------
alter table public.students
  add column if not exists name_normalized text
  generated always as (lower(regexp_replace(name, '\s+', '', 'g'))) stored;

create unique index if not exists ux_students_active_natural_key
  on public.students (tenant_id, name_normalized, coalesce(school, ''), coalesce(grade, ''))
  where status <> 'withdrawn';

-- E. enrollments overlap blocker (GiST EXCLUDE) -------------------------------
-- Same student + same class cannot have two overlapping active enrollments.
alter table public.enrollments
  drop constraint if exists enrollments_no_overlap;
alter table public.enrollments
  add constraint enrollments_no_overlap
  exclude using gist (
    student_id with =,
    class_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[)') with &&
  );

-- F. auth.users -> public.users sync ------------------------------------------
-- When admin createUser is called with raw_app_meta_data.tenant_id we mirror
-- the user into public.users. If tenant_id isn't set yet the trigger is a
-- no-op; the user can be back-filled later.
create or replace function public.tg_sync_user_from_auth() returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tenant uuid;
  v_role   public.system_role;
  v_name   text;
begin
  v_tenant := nullif(new.raw_app_meta_data ->> 'tenant_id', '')::uuid;
  v_role := coalesce(
    nullif(new.raw_app_meta_data ->> 'system_role', '')::public.system_role,
    'viewer'::public.system_role
  );
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1)
  );

  if v_tenant is null then
    return new;
  end if;

  insert into public.users (id, tenant_id, email, display_name, system_role, status)
  values (new.id, v_tenant, new.email, v_name, v_role, 'active')
  on conflict (id) do update set
    tenant_id    = excluded.tenant_id,
    email        = excluded.email,
    display_name = coalesce(public.users.display_name, excluded.display_name),
    system_role  = excluded.system_role;

  return new;
end;
$$;

drop trigger if exists tg_on_auth_user_change on auth.users;
create trigger tg_on_auth_user_change
  after insert or update of email, raw_app_meta_data, raw_user_meta_data
  on auth.users
  for each row execute function public.tg_sync_user_from_auth();

-- G. RLS enable + tenant isolation policies -----------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'tenants',
    'users',
    'classrooms',
    'classes',
    'students',
    'enrollments',
    'attendance_records',
    'announcements'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- tenants: members can read their own tenant row
drop policy if exists tenants_member_select on public.tenants;
create policy tenants_member_select on public.tenants
  for select to authenticated
  using (id = public.auth_tenant_id());

-- helper macro: identical tenant_isolation policy applied to every other table
do $$
declare t text;
begin
  foreach t in array array[
    'users',
    'classrooms',
    'classes',
    'students',
    'enrollments',
    'attendance_records',
    'announcements'
  ]
  loop
    execute format(
      'drop policy if exists %I_tenant_isolation on public.%I',
      t, t
    );
    execute format(
      'create policy %I_tenant_isolation on public.%I
         for all to authenticated
         using (tenant_id = public.auth_tenant_id())
         with check (tenant_id = public.auth_tenant_id())',
      t, t
    );
  end loop;
end $$;
