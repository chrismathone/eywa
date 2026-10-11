-- Platform-wide laboratory menu assignments. Only the server's service role
-- reads or changes this list; tenant access is decided by its own license.
create table public.lab_menu_assignments (
  menu_key text primary key,
  created_at timestamptz not null default now()
);

alter table public.lab_menu_assignments enable row level security;
revoke all on public.lab_menu_assignments from anon, authenticated;
grant select, insert, delete on public.lab_menu_assignments to service_role;

insert into public.lab_menu_assignments (menu_key) values ('makeups');

-- The makeup RPCs use this one settings reader for their mode. Keep the stored
-- academy choice intact, but treat it as off while its laboratory is closed.
create or replace function makeup_private.settings(p_tenant uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (
    select 1 from public.lab_menu_assignments where menu_key = 'makeups'
  ) and not exists (
    select 1 from public.tenant_licenses l
     where l.tenant_id = p_tenant and l.feature = 'laboratory'
       and l.is_active and (l.expires_at is null or l.expires_at > now())
  ) then jsonb_set(s.config, '{mode}', '"off"'::jsonb)
    else s.config end
  from (
    select makeup_private.normalize_settings(
      (select ts.data -> 'makeups' from public.tenant_settings ts where ts.tenant_id = p_tenant))
      || '{"allowAdditional": false, "pilotSubjects": ["math"]}'::jsonb as config
  ) s
$$;

-- Direct configure RPC calls must follow the same laboratory switch as the UI.
create or replace function makeup_private.require_mode(a makeup_private.actor_ctx, p_action text) returns void
language plpgsql set search_path = pg_catalog as $$
begin
  if p_action = 'configure' and exists (
    select 1 from public.lab_menu_assignments where menu_key = 'makeups'
  ) and not exists (
    select 1 from public.tenant_licenses l
     where l.tenant_id = a.tenant_id and l.feature = 'laboratory'
       and l.is_active and (l.expires_at is null or l.expires_at > now())
  ) then
    perform makeup_private.fail('forbidden', '보강 운영을 사용할 수 없습니다');
  end if;
  if a.mode = 'off' and p_action <> 'configure' then
    perform makeup_private.fail('mode_off', '보강관리가 꺼져 있습니다 — 학원 설정에서 켠 뒤 사용해 주세요');
  end if;
  if a.mode = 'draining' and p_action in ('intake', 'reserve', 'reschedule', 'link_legacy') then
    perform makeup_private.fail('mode_draining', '보강관리를 정리하는 중이라 새 접수와 새 일정은 받지 않습니다');
  end if;
end;
$$;
