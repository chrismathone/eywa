-- 역할별 대시보드 공개 설정: owner를 위임받은 계정의 직접 PATCH도 차단한다.
-- 0281a의 기존 permissions/preset/modules/위임 규칙을 그대로 두는 추가 가드.
-- 행·컬럼 변경 없음. 운영 공개 전에 적용(멱등).
create or replace function public.guard_dashboard_settings_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if exists (select 1 from public.users where id = auth.uid() and system_role = 'master')
     or coalesce(public.is_super_admin(auth.uid()), false) then
    return new;
  end if;
  raise exception '대시보드 공개 설정은 원장 또는 총괄만 변경할 수 있습니다'
    using errcode = '42501';
end;
$$;

drop trigger if exists tg_guard_dashboard_settings_write on public.tenant_settings;
create trigger tg_guard_dashboard_settings_write
before update of data on public.tenant_settings
for each row
when ((new.data -> 'dashboard') is distinct from (old.data -> 'dashboard'))
execute function public.guard_dashboard_settings_write();
