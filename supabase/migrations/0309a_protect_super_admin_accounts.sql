-- 0309a: 보호 계정(super_admins 명단)의 역할·재직 상태·소속 학원·삭제·명단 자체를 DB가 막는다 (원장 2026-09-30)
--
-- 원장: *"이승엽 superadmin 으로 등급업. 겉으로는 관리자. 박소선과 동일."* →
--       *"다음에 이런 일이 있어도 변경 안되게 강력 가드. 꼭 물어봐야하는걸로"*.
--
-- 앱 쪽 문(직원 역할 변경·퇴사·삭제·총괄 콘솔)은 `src/lib/auth/protected-accounts.ts`가 이미 막는다. 이 SQL은
-- **앱을 거치지 않는 길**(PostgREST 직결·스크립트·운영자 실수·다음 AI 세션의 "권한 정리")까지 막는 마지막 선이다.
--
-- 🔴 이름을 적지 않는다 — **명단(super_admins)에 있는 계정이 곧 보호 대상**이다. 새 총괄이 생기면 자동 보호.
--
-- 막는 것(보호 계정일 때):
--   · public.users   — system_role · status · tenant_id 변경, 행 삭제
--   · auth.users     — app_metadata의 system_role · tenant_id 변경, 로그인 차단(banned_until 설정), 행 삭제
--   · super_admins   — 행 수정·삭제(명단에서 빼기). 추가(INSERT)는 막지 않는다(새 총괄 지정은 원장 SQL).
--   ⚠️ **값이 실제로 바뀔 때만** 막는다 — 미러 트리거(0075a tg_sync_user_from_auth)는 로그인·이메일·이름이 바뀔 때마다
--      users를 같은 값으로 다시 쓰는데, 같은 값이면 통과해야 로그인·이름 변경이 안 깨진다.
--   ⚠️ 로그인 때 GoTrue가 app_metadata(providers 등)를 다시 쓰는 것도 system_role·tenant_id가 그대로면 통과한다.
--
-- 🔴 예외 문구에 '슈퍼관리자'·'총괄'을 쓰지 않는다 — authErr.message로 지점 화면에 뜰 수 있고, 지점에선 총괄이
--    '관리자'로 위장한다(displayRoleFor, 2026-07-02 결정).
-- ⚠️ 행 트리거는 TRUNCATE에 안 걸린다 → super_admins·users는 문장 단위 before truncate 트리거로 따로 막는다(4번).
--
-- 🔑 꼭 바꿔야 할 때(원장 명시 승인 후, SQL 편집기에서 한 트랜잭션으로):
--     begin;
--     set local app.allow_protected_change = 'on';
--     -- 여기서 변경
--     commit;
--
-- 앱 배포와 독립: 새 컬럼·시그니처 없음. 트리거만 붙인다. 적용 전·후 모두 앱은 정상 동작한다.
-- 멱등: create or replace function + drop trigger if exists → create.

set lock_timeout = '5s';

create or replace function public.protected_change_allowed() returns boolean
language sql stable
as $fn$
  select coalesce(current_setting('app.allow_protected_change', true), '') = 'on'
$fn$;

-- 1) public.users ----------------------------------------------------------------
create or replace function public.tg_guard_protected_users() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.protected_change_allowed() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.super_admins s where s.id = old.id) then
      raise exception '보호된 계정입니다 — 삭제할 수 없습니다. 운영자에게 요청하세요.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  -- UPDATE: 보호 칸이 실제로 바뀔 때만 명단을 본다(평소 ui_prefs 같은 저장은 조회 없이 통과).
  if new.system_role is distinct from old.system_role
     or new.status is distinct from old.status
     or new.tenant_id is distinct from old.tenant_id then
    if exists (select 1 from public.super_admins s where s.id = old.id) then
      raise exception '보호된 계정입니다 — 역할·상태는 여기서 바꿀 수 없습니다. 운영자에게 요청하세요.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists tg_guard_protected_users on public.users;
create trigger tg_guard_protected_users
  before update or delete on public.users
  for each row execute function public.tg_guard_protected_users();

-- 2) auth.users ------------------------------------------------------------------
create or replace function public.tg_guard_protected_auth_users() returns trigger
language plpgsql
security definer
set search_path = public, auth
as $fn$
begin
  if public.protected_change_allowed() then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.super_admins s where s.id = old.id) then
      raise exception '보호된 계정입니다 — 로그인 계정을 삭제할 수 없습니다. 운영자에게 요청하세요.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if (new.raw_app_meta_data ->> 'system_role') is distinct from (old.raw_app_meta_data ->> 'system_role')
     or (new.raw_app_meta_data ->> 'tenant_id') is distinct from (old.raw_app_meta_data ->> 'tenant_id')
     or (new.banned_until is not null and new.banned_until > now()
         and new.banned_until is distinct from old.banned_until) then
    if exists (select 1 from public.super_admins s where s.id = old.id) then
      raise exception '보호된 계정입니다 — 역할·소속·로그인 차단을 바꿀 수 없습니다. 운영자에게 요청하세요.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists tg_guard_protected_auth_users on auth.users;
create trigger tg_guard_protected_auth_users
  before update or delete on auth.users
  for each row execute function public.tg_guard_protected_auth_users();

-- 3) super_admins 명단 -------------------------------------------------------------
create or replace function public.tg_guard_super_admins() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.protected_change_allowed() then
    return coalesce(new, old);
  end if;
  raise exception '보호 명단은 바꿀 수 없습니다 — 운영자에게 요청하세요.' using errcode = 'P0001';
end;
$fn$;

drop trigger if exists tg_guard_super_admins on public.super_admins;
create trigger tg_guard_super_admins
  before update or delete on public.super_admins
  for each row execute function public.tg_guard_super_admins();

-- 4) TRUNCATE — 행 트리거가 안 걸리는 통째 비우기(명단을 비우면 보호가 전부 사라진다) ----------
create or replace function public.tg_guard_protected_truncate() returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if public.protected_change_allowed() then
    return null;
  end if;
  raise exception '보호된 표입니다 — 통째로 비울 수 없습니다. 운영자에게 요청하세요.' using errcode = 'P0001';
end;
$fn$;

drop trigger if exists tg_guard_super_admins_truncate on public.super_admins;
create trigger tg_guard_super_admins_truncate
  before truncate on public.super_admins
  for each statement execute function public.tg_guard_protected_truncate();

drop trigger if exists tg_guard_users_truncate on public.users;
create trigger tg_guard_users_truncate
  before truncate on public.users
  for each statement execute function public.tg_guard_protected_truncate();

revoke all on function public.tg_guard_protected_truncate() from public, anon, authenticated;
revoke all on function public.tg_guard_protected_users() from public, anon, authenticated;
revoke all on function public.tg_guard_protected_auth_users() from public, anon, authenticated;
revoke all on function public.tg_guard_super_admins() from public, anon, authenticated;

comment on function public.tg_guard_protected_users() is
  '0309a — super_admins 명단 계정의 system_role·status·tenant_id 변경·삭제 차단(원장 2026-09-30). 우회: set local app.allow_protected_change = ''on''';
