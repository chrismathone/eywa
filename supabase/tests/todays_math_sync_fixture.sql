-- ISOLATED TEST DATABASE ONLY. Minimal Supabase Auth roles/schema; source business
-- DDL is loaded from the real migrations by run-todays-math-sync-sql.mjs.
do $$ begin
 if current_database() <> 'eywa_source_test' then raise exception 'Isolated fixture database required'; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end; $$;
grant usage on schema public to anon,authenticated,service_role;
create schema auth;
create table auth.users (
 id uuid primary key, email text, role text default 'authenticated',
 banned_until timestamptz, deleted_at timestamptz,
 raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',
 encrypted_password text,last_sign_in_at timestamptz
);
create function public.auth_tenant_id() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.tenant_id',true),'')::uuid;
$$;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
