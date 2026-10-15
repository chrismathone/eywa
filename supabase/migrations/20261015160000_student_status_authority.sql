-- Status assignment is independent of menu access. Never change existing office/tenant RLS.
create schema if not exists student_status_private;
revoke all on schema student_status_private from public, anon;
grant usage on schema student_status_private to authenticated, service_role;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='student_status_lifecycle') then
    create role student_status_lifecycle nologin inherit nobypassrls;
  end if;
end $$;
grant authenticated to student_status_lifecycle;
-- Supabase's migration role needs SET authority to transfer function ownership (PG16+).
grant student_status_lifecycle to postgres;
-- Never grant the reverse membership: clients must not SET ROLE to this executor.

create or replace function student_status_private.menu(p_menu text) returns text
language plpgsql stable security definer set search_path=public as $$
declare r text:=public.auth_system_role(); d jsonb; a text; b text;
begin
  if auth.uid() is null or r='student' then return 'none'; end if;
  select data into d from public.tenant_settings where tenant_id=public.auth_tenant_id();
  -- These are core menus; disabled feature menus never grant them implicitly.
  select value->>'access' into a from jsonb_array_elements(
    case when jsonb_typeof(d->'permissions'->'userOverrides')='array' then d->'permissions'->'userOverrides' else '[]' end)
    with ordinality x(value,n) where value->>'menu'=p_menu and value->>'userId'=auth.uid()::text order by n desc limit 1;
  select value->>'access' into b from jsonb_array_elements(
    case when jsonb_typeof(d->'permissions'->'overrides')='array' then d->'permissions'->'overrides' else '[]' end)
    with ordinality x(value,n) where value->>'menu'=p_menu and value->>'role'=r order by n desc limit 1;
  if r='master' or public.is_super_admin(auth.uid()) then
    if p_menu in ('owner','admin') then return 'full'; end if;
    if coalesce(a,b)='full' then return 'full'; end if;
    a:=null; b:=null;
  end if;
  return coalesce(a,b,case
    when p_menu='students' and r in ('master','admin','manager','counselor') then 'full'
    when p_menu='classes' and r in ('master','admin','manager') then 'full'
    when p_menu='withdrawals' and r in ('master','admin','manager','counselor','accountant') then 'full'
    when p_menu in ('owner','admin') and r='master' then 'full'
    when p_menu in ('students','classes') and r='teacher' then 'scoped'
    when p_menu='students' and r in ('accountant','viewer') then 'readonly'
    when p_menu in ('classes','withdrawals') and r='viewer' then 'readonly'
    else 'none' end);
end $$;

create or replace function student_status_private.office() returns boolean
language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and public.auth_tenant_id() is not null
    and public.auth_system_role() in ('master','super_admin','admin','manager','counselor','accountant')
    and not (coalesce(current_setting('request.headers',true),'{}')::jsonb ? 'x-aywa-tenant-view')
$$;

create or replace function student_status_private.allowed() returns boolean
language plpgsql stable security definer set search_path=public as $$
declare s jsonb; ids jsonb;
begin
  if not student_status_private.office() then return false; end if;
  select data->'permissions'->'specialAccess' into s from public.tenant_settings where tenant_id=public.auth_tenant_id();
  if s is not null and jsonb_typeof(s)<>'object' then return false; end if;
  if s is null or not (s ? 'studentStatusManagerIds') then
    return student_status_private.menu('students')='full' or student_status_private.menu('admin')='full';
  end if;
  if student_status_private.menu('students')<>'full' then return false; end if;
  if public.auth_system_role()='master' or public.is_super_admin(auth.uid()) then return true; end if;
  ids:=s->'studentStatusManagerIds';
  if jsonb_typeof(ids) is distinct from 'array' or jsonb_array_length(ids)>80 then return false; end if;
  if exists(select 1 from jsonb_array_elements(ids) v where jsonb_typeof(v)<>'string'
    or (v#>>'{}') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$')
    or (select count(distinct v) from jsonb_array_elements(ids) v)<>jsonb_array_length(ids) then return false; end if;
  return ids ? auth.uid()::text;
end $$;

create or replace function student_status_private.date_allowed(p_class uuid) returns boolean
language plpgsql stable security definer set search_path=public as $$
declare d jsonb; levels text[]; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if auth.uid() is null or public.auth_system_role()='student' or
    coalesce(current_setting('request.headers',true),'{}')::jsonb ? 'x-aywa-tenant-view' then return false; end if;
  if not exists(select 1 from public.classes where id=p_class and tenant_id=public.auth_tenant_id()) then return false; end if;
  select data into d from public.tenant_settings where tenant_id=public.auth_tenant_id();
  if public.auth_system_role()<>'master' and not public.is_super_admin(auth.uid()) and
    not coalesce((d->'permissions'->'specialAccess'->'enrollmentDateEditorIds') ? auth.uid()::text,false) then return false; end if;
  levels:=array[student_status_private.menu('students'),student_status_private.menu('classes'),student_status_private.menu('withdrawals')];
  if levels && array['full','readonly'] then return true; end if;
  if not ('scoped'=any(levels)) then return false; end if;
  return exists(select 1 from public.classes where id=p_class and teacher_id=auth.uid())
    or exists(select 1 from public.class_schedules where class_id=p_class and teacher_id=auth.uid())
    or exists(select 1 from public.class_delegations where class_id=p_class and delegate_user_id=auth.uid()
      and tenant_id=public.auth_tenant_id() and revoked_at is null and from_date<=today+7 and to_date>=today-7);
end $$;

create or replace function student_status_private.require_lifecycle(p_menu text) returns void
language plpgsql stable security definer set search_path=public as $$
begin
  if auth.role()='service_role' or (auth.uid() is null and session_user in ('postgres','supabase_admin')) then return; end if;
  if not student_status_private.office() or student_status_private.menu(p_menu)<>'full' then
    raise exception '수강 변경 권한이 없습니다';
  end if;
end $$;

revoke all on all functions in schema student_status_private from public, anon;
grant execute on all functions in schema student_status_private to authenticated, service_role;
