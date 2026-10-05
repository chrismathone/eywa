-- Only Supabase platform schemas are synthesized; all application DDL comes from repository migrations.
do $$ begin
  if current_database() <> 'makeup_chain' then raise exception 'Local makeup_chain DB required'; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, role text default 'authenticated', banned_until timestamptz, deleted_at timestamptz,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''), nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid
$$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
-- Vault is a local catalog stub only; no encryption or secret-service behavior is tested.
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text);
create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text) returns uuid language sql as $$
  insert into vault.secrets(secret) values(p_secret) returning id
$$;
create function vault.update_secret(p_id uuid, p_secret text) returns void language sql as $$
  update vault.secrets set secret=p_secret where id=p_id
$$;
do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
end $$;
