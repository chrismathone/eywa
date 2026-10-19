-- Minimal existing AYWA contracts; all identifiers and notes are synthetic.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema public,auth to authenticated,anon,service_role;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create table tenants(id uuid primary key);
create table users(id uuid primary key,tenant_id uuid references tenants(id),system_role text,status text,access text);
create table tenant_settings(tenant_id uuid primary key references tenants(id),data jsonb);
create table student_consultations(id uuid primary key,tenant_id uuid,student_id uuid,counselor_id uuid,
  follow_up_date date,follow_up_done boolean not null default false);
create table notifications(id uuid primary key default gen_random_uuid(),tenant_id uuid,recipient_id uuid,
  type text,title text,body text,link text,actor_id uuid,created_at timestamptz default now());
create function auth_tenant_id() returns uuid language sql stable security definer set search_path=public as $$
  select tenant_id from users where id=auth.uid();
$$;
create function auth_menu_access(text) returns text language sql stable security definer set search_path=public as $$
  select access from users where id=auth.uid();
$$;
insert into tenants values ('10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000001');
insert into users values
  ('10000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','master','active','full'),
  ('10000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','teacher','active','scoped'),
  ('10000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','teacher','active','scoped'),
  ('10000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','observer','active','readonly'),
  ('10000000-0000-4000-8000-000000000015','10000000-0000-4000-8000-000000000001','student','active','none'),
  ('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','master','active','full');
insert into tenant_settings values
  ('10000000-0000-4000-8000-000000000001','{"notifications":{"managementAgent":{"mode":"observe","acknowledgeDays":1,"reminderDays":3,"notionAlerts":true}}}'),
  ('20000000-0000-4000-8000-000000000001','{"notifications":{"managementAgent":{"mode":"active"}}}');
insert into student_consultations values
  ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000012',current_date-2,false),
  ('20000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000031','20000000-0000-4000-8000-000000000011',current_date-2,false);
