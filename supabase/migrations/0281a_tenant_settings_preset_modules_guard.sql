-- 0281a: tenant_settings 쓰기 트리거 — 학원 종류(preset)·기능 켜기·끄기(modules)도 원장 전용으로. 멱등.
-- 배경(적대 리뷰 2026-09-22, 일반판 d5720191): 0080a 트리거는 permissions만 잠가서, owner를 위임받은 계정
--   (침산 실측 활성 11명)이 PostgREST로 직접 `data.preset="generic"`·`data.modules`를 PATCH할 수 있었다.
--   침산엔 '기능' 면이 없고 saveOwnerSection도 침산 modules 저장을 거절하므로, 그렇게 들어간 값은 **화면으로
--   되돌릴 방법이 없다**(SQL로만). 앱은 이미 modules 섹션을 원장·총괄에게만 연다 — 이 트리거가 이중 방어다(#77).
--
-- 0080a 규칙은 전부 그대로 두고 UPDATE 분기에 한 줄만 더한다:
--   ① permissions 변경 = master 전용(불변)
--   ①' preset·modules 변경 = master 또는 총괄(super_admin) 전용 ← 추가
--   ② 위임 판정은 저장된(OLD) override만 신뢰(불변)
--   ③ 최초 INSERT·DELETE = master 전용(불변)
-- service_role(auth.uid() null) — 학원 추가가 표식 행을 만드는 경로 — 는 종전대로 통과한다.
-- 앱이 쓰는 값은 바뀌지 않는다: 저장 경로는 preset을 **같은 값**으로만 다시 쓰고(일반판 행), 침산 행엔 안 쓴다.

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
  -- ①' 학원 종류(preset)·기능 켜기·끄기(modules) — "무엇이 있나"를 정하는 층이라 권한과 같은 급(0281a).
  if ((new.data -> 'preset') is distinct from (old.data -> 'preset')
      or (new.data -> 'modules') is distinct from (old.data -> 'modules'))
     and not coalesce(public.is_super_admin(auth.uid()), false) then
    raise exception '학원 종류·기능 켜기·끄기는 원장(master)만 변경할 수 있습니다';
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

-- 트리거(tg_guard_tenant_settings_write, 0080a)는 이 함수를 그대로 부른다 — 교체 불필요.
