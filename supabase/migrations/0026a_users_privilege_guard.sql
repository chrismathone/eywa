-- users 권한 컬럼 self-escalation 차단 (#S2) — 손수 alpha. 멱등(create or replace + drop/create trigger).
-- 배경: users는 다른 테이블과 같은 generic tenant_isolation 정책뿐이라, 인증 사용자가 anon 키 + 유효
-- 세션으로 PostgREST에 직접 `update users set system_role='master'`를 보내도 RLS가 tenant_id만 보고 통과한다.
-- 앱 레이어 역할 위계가 DB로 뒷받침되지 않던 것을, system_role/tenant_id 변경을 트리거로 막아 보강한다.
-- 앱의 정당한 역할 변경은 service_role(admin 클라이언트, auth.uid() = null)로만 일어나므로 그 경로는 통과시킨다.

create or replace function public.guard_user_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role(admin) 경로는 사용자 JWT가 없다(auth.uid() null) → 통과. 인증 사용자만 제약.
  if auth.uid() is null then
    return new;
  end if;
  if new.system_role is distinct from old.system_role then
    raise exception 'system_role은 직접 변경할 수 없습니다 (관리자 도구를 사용하세요)';
  end if;
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id는 직접 변경할 수 없습니다';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_guard_user_privilege_columns on public.users;
create trigger tg_guard_user_privilege_columns
  before update on public.users
  for each row
  execute function public.guard_user_privilege_columns();
