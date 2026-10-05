-- Only surrounding shell reads are synthesized. Makeup RPCs use the actual migrations.
alter table public.users add column job_title text;
create table public.tenant_licenses (tenant_id uuid, feature text, is_active boolean, expires_at timestamptz, updated_at timestamptz);
create table public.user_preferences (tenant_id uuid, user_id uuid, preferences jsonb default '{}', updated_at timestamptz default now());
-- Fresh public.users remains the app's actual actor source. Never use a production connection.
grant select on public.users, public.tenants, public.tenant_settings, public.tenant_licenses,
  public.classes, public.students, public.classrooms, public.user_preferences to authenticated, service_role;
notify pgrst, 'reload schema';
