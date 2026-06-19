-- tenant_settings 쓰기 self-escalation 차단 (역할/권한 배선 감사 갭 #1) — 손수 alpha. 멱등.
-- 배경: tenant_settings는 generic tenant_isolation 정책뿐이라, 같은 테넌트 인증 사용자(teacher 등)가
-- PostgREST로 `update tenant_settings set data=...`(권한 override 자기부여 포함)를 직접 보내도 RLS가
-- tenant_id만 보고 통과한다. 앱(saveOwnerSection)은 master 게이트지만 직접 API 변조는 막지 못했다.
-- → 권한 override의 유일한 쓰기 경로가 owner(master)임을 DB에서도 강제. 0026a users_privilege_guard 패턴 동일.
-- 앱의 정당한 저장은 master 세션(auth.uid()=master) 또는 service_role(admin, auth.uid()=null)로만 일어난다.

create or replace function public.guard_tenant_settings_master_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role(admin 클라이언트)·직접 DB 연결은 사용자 JWT가 없다(auth.uid() null) → 통과.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- 인증 사용자: 자기 테넌트의 master만 학원 설정(권한 override 포함) 쓰기 허용. (테넌트 격리는 RLS가 별도 강제.)
  if not exists (
    select 1 from public.users where id = auth.uid() and system_role = 'master'
  ) then
    raise exception '학원 설정(tenant_settings)은 원장(master)만 변경할 수 있습니다';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_guard_tenant_settings_master_only on public.tenant_settings;
create trigger tg_guard_tenant_settings_master_only
  before insert or update or delete on public.tenant_settings
  for each row
  execute function public.guard_tenant_settings_master_only();
