-- 0080a: tenant_settings 위임 쓰기 — 역할·권한 매트릭스(owner 메뉴 override)를 DB 게이트에도 반영. 멱등.
-- 배경: 0038a 트리거는 무조건 master-only라, 원장이 역할·권한에서 admin/manager에게 owner(학원 설정)를
-- 위임(override: {menu:'owner', role, access:'full'})해도 DB가 저장을 거부 → 앱 게이트(canWriteTenant)와
-- 어긋난다(2026-07-06 "관리자가 강의실 추가를 못함" 계열 — 설정 저장도 동일 갭).
--
-- self-escalation 차단(0038a의 존재 이유)은 그대로 유지:
--   ① permissions(역할·권한) 섹션 변경은 여전히 master 전용 — 위임받은 역할이 자기/타인 권한을 못 바꿈.
--   ② 위임 판정은 "저장된(OLD) override"만 신뢰 — 자기 요청의 NEW 값으로 자기에게 권한 부여 불가.
--   ③ 최초 행 INSERT·DELETE는 master 전용.
-- 즉 비-master는 "master가 미리 위임해 둔 경우에만, 권한 섹션을 건드리지 않는 UPDATE만" 가능.

create or replace function public.guard_tenant_settings_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- service_role(admin 클라이언트)·직접 DB 연결은 사용자 JWT가 없다(auth.uid() null) → 통과.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  select system_role into v_role from public.users where id = auth.uid();
  if v_role = 'master' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception '학원 설정(tenant_settings)은 원장(master)만 삭제할 수 있습니다';
  end if;

  if tg_op = 'INSERT' then
    -- 앱 저장은 upsert(insert … on conflict do update)라 BEFORE INSERT가 먼저 발화한다.
    -- 기존 행이 있으면(=곧 UPDATE 경로로 귀결) 통과시키고 실제 검증은 아래 UPDATE 분기가 수행.
    -- (plain insert였다면 어차피 tenant_id 유니크 제약으로 실패 — 우회 불가.)
    if exists (select 1 from public.tenant_settings t where t.tenant_id = new.tenant_id) then
      return new;
    end if;
    raise exception '학원 설정 최초 생성은 원장(master)만 가능합니다';
  end if;

  -- UPDATE: ① 역할·권한(permissions) 섹션은 불변이어야 함 — self-escalation 차단.
  if (new.data -> 'permissions') is distinct from (old.data -> 'permissions') then
    raise exception '역할·권한(permissions)은 원장(master)만 변경할 수 있습니다';
  end if;
  -- ② 저장된(OLD) override가 이 역할에 owner 쓰기(full/scoped)를 위임했는지 — NEW는 신뢰하지 않는다.
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(old.data -> 'permissions' -> 'overrides', '[]'::jsonb)) o
    where o ->> 'menu' = 'owner'
      and o ->> 'role' = v_role
      and o ->> 'access' in ('full', 'scoped')
  ) then
    raise exception '학원 설정(tenant_settings)은 원장(master) 또는 위임된 역할만 변경할 수 있습니다';
  end if;

  return new;
end;
$$;

-- 트리거 교체(0038a tg_guard_tenant_settings_master_only → tg_guard_tenant_settings_write).
drop trigger if exists tg_guard_tenant_settings_master_only on public.tenant_settings;
drop trigger if exists tg_guard_tenant_settings_write on public.tenant_settings;
create trigger tg_guard_tenant_settings_write
  before insert or update or delete on public.tenant_settings
  for each row
  execute function public.guard_tenant_settings_write();

-- 옛 함수 정리(트리거를 먼저 떼야 drop 가능).
drop function if exists public.guard_tenant_settings_master_only();
