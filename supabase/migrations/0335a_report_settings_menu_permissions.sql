-- 공용 설정을 학원 설정(owner)에서 분리한다. 기존 위임은 처음 한 번 복사한다.
-- 재실행 때 이미 지정한 메뉴 권한은 덮지 않는다.
with additions as (
  select t.tenant_id,
    coalesce((select jsonb_agg((o - 'menu') || jsonb_build_object('menu', m.menu))
      from jsonb_array_elements(coalesce(t.data->'permissions'->'overrides', '[]')) o
      cross join unnest(array['report_settings','ai_ment','profile_settings','operations_settings','billing_settings','notification_settings','consultation_settings','navigation_settings','integration_settings','popup_settings']) m(menu)
      where o->>'menu' = 'owner' and not exists (
        select 1 from jsonb_array_elements(coalesce(t.data->'permissions'->'overrides','[]')) n
        where n->>'menu' = m.menu and n->>'role' = o->>'role')), '[]') as roles,
    coalesce((select jsonb_agg((o - 'menu') || jsonb_build_object('menu', m.menu))
      from jsonb_array_elements(coalesce(t.data->'permissions'->'userOverrides', '[]')) o
      cross join unnest(array['report_settings','ai_ment','profile_settings','operations_settings','billing_settings','notification_settings','consultation_settings','navigation_settings','integration_settings','popup_settings']) m(menu)
      where o->>'menu' = 'owner' and not exists (
        select 1 from jsonb_array_elements(coalesce(t.data->'permissions'->'userOverrides','[]')) n
        where n->>'menu' = m.menu and n->>'userId' = o->>'userId')), '[]') as people
  from public.tenant_settings t
)
update public.tenant_settings t set data = jsonb_set(t.data, '{permissions}',
  coalesce(t.data->'permissions','{}') || jsonb_build_object(
    'overrides', coalesce(t.data->'permissions'->'overrides','[]') || a.roles,
    'userOverrides', coalesce(t.data->'permissions'->'userOverrides','[]') || a.people)), updated_at = now()
from additions a where t.tenant_id = a.tenant_id and (a.roles <> '[]' or a.people <> '[]');

-- 입력으로 받은 OLD 권한만 판정하는 순수 함수. 쓰기 권한과 개인정보 조회 권한은 부여하지 않는다.
create or replace function public.settings_menu_access(p_permissions jsonb, p_menu text, p_role text, p_user uuid, p_super boolean default false)
returns text language sql immutable security invoker set search_path = public as $$
  select case
    when p_menu not in ('report_settings','ai_ment','profile_settings','operations_settings','billing_settings','notification_settings','consultation_settings','navigation_settings','integration_settings','popup_settings','attendance_salary_settings','payroll_settings') then 'none'
    when p_super then 'full'
    when p_role = 'student' or p_role is null then 'none'
    else coalesce(
      (select o->>'access' from jsonb_array_elements(coalesce(p_permissions->'userOverrides','[]')) with ordinality x(o,n)
       where o->>'menu'=p_menu and o->>'userId'=p_user::text and not (p_role='master' and o->>'access'='none') order by n desc limit 1),
      (select o->>'access' from jsonb_array_elements(coalesce(p_permissions->'overrides','[]')) with ordinality x(o,n)
       where o->>'menu'=p_menu and o->>'role'=p_role and not (p_role='master' and o->>'access'='none') order by n desc limit 1),
      case when p_role='master' or (p_menu='attendance_salary_settings' and p_role in ('admin','manager')) then 'full' else 'none' end)
  end
$$;
revoke all on function public.settings_menu_access(jsonb,text,text,uuid,boolean) from public;
grant execute on function public.settings_menu_access(jsonb,text,text,uuid,boolean) to authenticated, service_role;

-- 설정 본문 UPDATE는 변경한 섹션의 권한을 모두 요구한다. 권한 자체의 변경은 원장만 가능하다.
create or replace function public.guard_tenant_settings_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_super boolean;
  v_section text;
  v_menu text;
  v_keys text[] := array['profile','operations','billing','notifications','consultations','navigation','report'];
begin
  if auth.uid() is null then return coalesce(new,old); end if;
  select system_role into v_role from public.users where id=auth.uid();
  if v_role='master' then return coalesce(new,old); end if;
  if tg_op='DELETE' then raise exception '학원 설정은 원장만 삭제할 수 있습니다'; end if;
  if tg_op='INSERT' then
    if exists(select 1 from public.tenant_settings where tenant_id=new.tenant_id) then return new; end if;
    raise exception '학원 설정 최초 생성은 원장만 가능합니다';
  end if;
  if (new.data->'permissions') is distinct from (old.data->'permissions') then
    raise exception '역할·권한은 원장만 변경할 수 있습니다';
  end if;
  if (new.data->'version') is distinct from (old.data->'version') and (new.data->'version') is distinct from '1'::jsonb then
    raise exception '설정 문서 버전은 변경할 수 없습니다';
  end if;
  v_super := coalesce(public.is_super_admin(auth.uid()),false);
  if ((new.data->'preset') is distinct from (old.data->'preset') or (new.data->'modules') is distinct from (old.data->'modules')) and not v_super then
    raise exception '학원 종류·기능은 원장만 변경할 수 있습니다';
  end if;
  foreach v_section in array v_keys loop
    if (new.data->v_section) is distinct from (old.data->v_section) then
      v_menu := case v_section
        when 'profile' then 'profile_settings' when 'operations' then 'operations_settings'
        when 'billing' then 'billing_settings' when 'notifications' then 'notification_settings'
        when 'consultations' then 'consultation_settings' when 'navigation' then 'navigation_settings'
        when 'report' then 'report_settings' end;
      if public.settings_menu_access(old.data->'permissions',v_menu,v_role,auth.uid(),v_super) not in ('full','scoped') then
        raise exception '해당 설정 변경 권한이 없습니다';
      end if;
    end if;
  end loop;
  -- 개별 설정 이외의 데이터는 이전처럼 owner 위임을 요구한다.
  if (new.data - v_keys - 'version') is distinct from (old.data - v_keys - 'version') and not v_super and not exists (
    select 1 from jsonb_array_elements(coalesce(old.data->'permissions'->'overrides','[]')) o
    where o->>'menu'='owner' and o->>'role'=v_role and o->>'access' in ('full','scoped')) then
    raise exception '학원 설정 변경 권한이 없습니다';
  end if;
  return new;
end;
$$;

-- 자동작성은 프롬프트 읽기를 계속 사용한다. 직접 쓰기만 AI 멘트 메뉴 권한으로 막는다.
drop policy if exists ai_prompt_overrides_menu_insert on public.ai_prompt_overrides;
create policy ai_prompt_overrides_menu_insert on public.ai_prompt_overrides as restrictive for insert to authenticated
with check ((select public.settings_menu_access(
  (select data->'permissions' from public.tenant_settings where tenant_id=public.auth_tenant_id()),
  'ai_ment',public.auth_system_role(),auth.uid(),public.is_super_admin(auth.uid()))) in ('full','scoped'));

-- 프롬프트 교체·복원을 원자적으로 처리한다. 권한 회수/실패가 이전 활성 버전을 없애면 안 된다.
create or replace function public.save_ai_prompt_setting(p_type text, p_text text)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_tenant uuid := public.auth_tenant_id();
  v_permissions jsonb;
  v_placeholder text;
begin
  if auth.uid() is null or v_tenant is null then raise exception '로그인이 필요합니다'; end if;
  select data->'permissions' into v_permissions from public.tenant_settings where tenant_id=v_tenant for share;
  if public.settings_menu_access(v_permissions,'ai_ment',public.auth_system_role(),auth.uid(),public.is_super_admin(auth.uid())) not in ('full','scoped') then
    raise exception 'AI 멘트 변경 권한이 없습니다';
  end if;
  v_placeholder := case p_type when 'comment' then '{{facts}}' when 'trend' then '{{historySummary}}'
    when 'comment_p1' then '{{p1facts}}' when 'comment_p2' then '{{p2facts}}' end;
  if v_placeholder is null then raise exception '알 수 없는 프롬프트 유형'; end if;
  if p_text is not null and position(v_placeholder in p_text)=0 then raise exception '프롬프트 자리표시자가 필요합니다'; end if;
  perform pg_advisory_xact_lock(hashtext(v_tenant::text),hashtext(p_type));
  update public.ai_prompt_overrides set is_active=false where tenant_id=v_tenant and prompt_type=p_type and is_active;
  if p_text is not null then
    insert into public.ai_prompt_overrides(tenant_id,prompt_type,prompt_text,is_active,created_by)
    values(v_tenant,p_type,btrim(p_text),true,auth.uid());
  end if;
end;
$$;
revoke all on function public.save_ai_prompt_setting(text,text) from public;
grant execute on function public.save_ai_prompt_setting(text,text) to authenticated, service_role;

-- 별도 표에 저장되는 설정도 직접 API 요청으로 역할 제한을 우회하지 못하게 한다.
-- 읽기 정책과 기존 학원 격리는 그대로 두고, 허용되지 않은 쓰기는 명시적인 오류로 돌려준다.
create or replace function public.guard_shared_setting_write()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  v_data jsonb;
begin
  if auth.uid() is null then return coalesce(new,old); end if;
  select data into v_data from public.tenant_settings where tenant_id=public.auth_tenant_id();
  if tg_table_name='user_integrations' then
    -- 기존 행 upsert의 INSERT 단계는 UPDATE 단계에서 실제 변경 컬럼을 판정한다.
    if tg_op='INSERT' and exists(select 1 from public.user_integrations where tenant_id=new.tenant_id and provider=new.provider) then return new; end if;
    -- 동기화 진행·성공·실패 기록은 연동 설정 변경이 아니다.
    if tg_op='UPDATE' then
      if (to_jsonb(new) - array['last_synced_at','last_error','sync_started_at','updated_at'])
        is not distinct from (to_jsonb(old) - array['last_synced_at','last_error','sync_started_at','updated_at']) then return new; end if;
      -- 구 수학 시트의 학원 기본 주소를 상태 기록에 채우는 기존 동작도 보존한다.
      if new.provider='google_sheets' and old.spreadsheet_id is null
        and new.spreadsheet_id = v_data->'notifications'->>'googleSheetId'
        and (to_jsonb(new) - array['spreadsheet_id','last_synced_at','last_error','sync_started_at','updated_at'])
          is not distinct from (to_jsonb(old) - array['spreadsheet_id','last_synced_at','last_error','sync_started_at','updated_at']) then return new; end if;
    end if;
  end if;
  if public.settings_menu_access(v_data->'permissions',tg_argv[0],public.auth_system_role(),auth.uid(),public.is_super_admin(auth.uid())) not in ('full','scoped') then
    raise exception '해당 설정 변경 권한이 없습니다';
  end if;
  return coalesce(new,old);
end;
$$;
revoke all on function public.guard_shared_setting_write() from public;
grant execute on function public.guard_shared_setting_write() to authenticated, service_role;
drop trigger if exists classrooms_setting_role_guard on public.classrooms;
create trigger classrooms_setting_role_guard before insert or update or delete on public.classrooms
for each row execute function public.guard_shared_setting_write('operations_settings');
drop trigger if exists notice_popups_setting_role_guard on public.notice_popups;
create trigger notice_popups_setting_role_guard before insert or update or delete on public.notice_popups
for each row execute function public.guard_shared_setting_write('popup_settings');
drop trigger if exists user_integrations_setting_role_guard on public.user_integrations;
create trigger user_integrations_setting_role_guard before insert or update or delete on public.user_integrations
for each row execute function public.guard_shared_setting_write('integration_settings');
drop policy if exists ai_prompt_overrides_menu_update on public.ai_prompt_overrides;
create policy ai_prompt_overrides_menu_update on public.ai_prompt_overrides as restrictive for update to authenticated
using ((select public.settings_menu_access(
  (select data->'permissions' from public.tenant_settings where tenant_id=public.auth_tenant_id()),
  'ai_ment',public.auth_system_role(),auth.uid(),public.is_super_admin(auth.uid()))) in ('full','scoped'))
with check ((select public.settings_menu_access(
  (select data->'permissions' from public.tenant_settings where tenant_id=public.auth_tenant_id()),
  'ai_ment',public.auth_system_role(),auth.uid(),public.is_super_admin(auth.uid()))) in ('full','scoped'));
