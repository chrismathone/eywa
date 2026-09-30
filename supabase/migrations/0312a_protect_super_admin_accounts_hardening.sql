-- 0312a: 보호 계정(super_admins 명단) 가드 보강 — 0309a의 빈틈 둘 + 권한 층 + 점검용 조회 (원장 2026-09-30)
--
-- 원장: *"방어가드가 확실한지만 더 체크 몇번 더해봐 2,3중이상으로 해도 되니까"*.
-- 운영 DB에서 되돌리는 트랜잭션으로 공격을 하나씩 쏴 본 결과(2026-09-30) 0309a는 역할·상태·소속·삭제·명단을
-- 전부 막았지만 **auth.users 소프트 삭제(`deleted_at`)는 통과**했다(GoTrue `deleteUser(id, true)` 경로 = 로그인 불가).
--
-- 이 파일이 더하는 것:
--   1) auth.users 트리거 확장 — `deleted_at` 설정(소프트 삭제)·`role` 변경(JWT 역할 = PostgREST 접속 역할)도 막는다.
--   2) 권한 층(트리거와 독립) — super_admins의 수정·삭제·비우기 권한과 users 비우기 권한을 API 역할에서 뺀다.
--      트리거가 꺼지거나 지워져도 API 키(anon·authenticated·service_role)로는 명단을 못 건드린다.
--      INSERT·SELECT는 남긴다(새 총괄 지정 = scripts/provision-admin7099.ts · 명단 조회 = 앱 전역).
--   3) `protected_guard_triggers()` — 매일 점검 크론이 가드 트리거가 살아 있고 켜져 있는지 확인하는 조회
--      (service_role 전용). 트리거가 꺼진 것은 데이터만 봐서는 모른다 — 바뀌는 날까지 조용하다.
--
-- 🔴 예외 문구에 '슈퍼관리자'·'총괄' 금지(0309a와 같은 이유 — 지점 화면에 뜰 수 있다).
-- 우회는 0309a와 같다: 원장 명시 승인 후 `begin; set local app.allow_protected_change = 'on'; …; commit;`
--   (단 2)의 권한 회수는 스위치로 안 풀린다 — postgres 역할(SQL 편집기)은 테이블 소유자라 영향 없음).
-- 앱 배포와 독립: 앱은 3)이 없어도 돈다(점검이 '트리거 확인 불가'로만 남긴다). 멱등.

set lock_timeout = '5s';

-- 1) auth.users 트리거 확장 ----------------------------------------------------------
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
         and new.banned_until is distinct from old.banned_until)
     -- 0312a: 소프트 삭제(GoTrue deleteUser(id, true))는 행을 남기고 deleted_at만 찍는다 = 로그인 불가.
     or (new.deleted_at is not null and new.deleted_at is distinct from old.deleted_at)
     -- 0312a: auth 역할('authenticated')이 바뀌면 JWT 역할이 바뀌어 PostgREST 접속 자체가 달라진다.
     or new.role is distinct from old.role then
    if exists (select 1 from public.super_admins s where s.id = old.id) then
      raise exception '보호된 계정입니다 — 역할·소속·로그인 차단을 바꿀 수 없습니다. 운영자에게 요청하세요.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;
-- 트리거 자체는 0309a가 붙였다(함수만 교체 — 같은 이름이라 재부착 불필요).
revoke all on function public.tg_guard_protected_auth_users() from public, anon, authenticated;

-- 2) 권한 층 --------------------------------------------------------------------------
revoke update, delete, truncate on public.super_admins from anon, authenticated, service_role;
revoke insert on public.super_admins from anon, authenticated;
revoke truncate on public.users from anon, authenticated, service_role;

-- 3) 점검용 조회 -----------------------------------------------------------------------
create or replace function public.protected_guard_triggers()
returns table (trigger_name text, table_name text, enabled text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select t.tgname::text, (n.nspname || '.' || c.relname)::text, t.tgenabled::text
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal
     and t.tgname in ('tg_guard_protected_users', 'tg_guard_users_truncate', 'tg_guard_protected_auth_users',
                      'tg_guard_super_admins', 'tg_guard_super_admins_truncate')
$fn$;
revoke all on function public.protected_guard_triggers() from public, anon, authenticated;
grant execute on function public.protected_guard_triggers() to service_role;

comment on function public.protected_guard_triggers() is
  '0312a — 보호 계정 가드 트리거 5개의 존재·활성 상태(매일 점검 크론 전용, service_role만).';
