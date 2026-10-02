-- Named, immutable English practice snapshots. No operating timetable writes.
-- auth_menu_access's historic defaults omit timetable/classes, so do not reuse it here.
-- This invoker function mirrors only the two full-management gates, including per-user overrides.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.auth_can_use_timetable_lab() returns boolean
language sql stable security invoker set search_path = public as $$
  with me as (
    select u.id, u.system_role::text as role, coalesce(public.is_super_admin(u.id),false) as super,
      coalesce(ts.data->'permissions','{}'::jsonb) as permissions
    from public.users u left join public.tenant_settings ts on ts.tenant_id=u.tenant_id
    where u.id=(select auth.uid()) and u.tenant_id=(select public.auth_tenant_id())
      and u.status <> 'inactive' and u.system_role::text <> 'student'
  ), levels as (
    select me.*, menu,
      case when role in ('master','admin','manager') then 'full' else 'none' end as base,
      (select o->>'access' from jsonb_array_elements(coalesce(permissions->'overrides','[]'::jsonb)) with ordinality x(o,n)
        where o->>'menu'=menu and o->>'role'=role order by n desc limit 1) as role_access,
      (select o->>'access' from jsonb_array_elements(coalesce(permissions->'userOverrides','[]'::jsonb)) with ordinality x(o,n)
        where o->>'menu'=menu and o->>'userId'=id::text order by n desc limit 1) as user_access
    from me cross join unnest(array['timetable','classes']) as menus(menu)
  )
  select coalesce(bool_and(case when super then
    base='full' or coalesce(role_access='full',false) or coalesce(user_access='full',false)
    else coalesce(user_access,role_access,base)='full' end),false) from levels
$$;
revoke all on function public.auth_can_use_timetable_lab() from public, anon;
grant execute on function public.auth_can_use_timetable_lab() to authenticated, service_role;

create table if not exists public.timetable_lab_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  subject text not null default 'english' check (subject='english'),
  version integer not null default 1 check (version=1),
  snapshot jsonb not null check (
    jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=2097152
    and jsonb_typeof(snapshot->'cells')='array' and jsonb_typeof(snapshot->'placements')='array'
    and jsonb_typeof(snapshot->'students')='object'
    and snapshot ?& array['cells','placements','students']
    and (not (snapshot ? 'source') or coalesce((snapshot->'source'->>'tenantId')=tenant_id::text,false))
  ),
  lesson_count integer not null check (lesson_count between 0 and 5000),
  class_count integer not null check (class_count between 0 and 5000),
  student_count integer not null check (student_count between 0 and 20000),
  reference_date date,
  created_at timestamptz not null default now()
);
create index if not exists timetable_lab_drafts_owner_list_idx
  on public.timetable_lab_drafts (tenant_id,created_by,subject,created_at desc,id desc);
create index if not exists timetable_lab_drafts_creator_idx on public.timetable_lab_drafts(created_by);
alter table public.timetable_lab_drafts enable row level security;
revoke all on public.timetable_lab_drafts from public, anon, authenticated;
grant select,insert on public.timetable_lab_drafts to authenticated;
grant all on public.timetable_lab_drafts to service_role;

drop policy if exists timetable_lab_drafts_read_own on public.timetable_lab_drafts;
create policy timetable_lab_drafts_read_own on public.timetable_lab_drafts for select to authenticated
using (tenant_id=(select public.auth_tenant_id()) and created_by=(select auth.uid()) and (select public.auth_can_use_timetable_lab()));
drop policy if exists timetable_lab_drafts_insert_own on public.timetable_lab_drafts;
create policy timetable_lab_drafts_insert_own on public.timetable_lab_drafts for insert to authenticated
with check (tenant_id=(select public.auth_tenant_id()) and created_by=(select auth.uid()) and (select public.auth_can_use_timetable_lab()));

comment on table public.timetable_lab_drafts is 'Private immutable timetable practice snapshots; never applied to operating schedules automatically.';
commit;
