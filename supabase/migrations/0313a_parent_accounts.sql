-- 학부모 계정과 원생 연결. 직원(users) 계정과 분리해 부모 포털 권한을 별도 확장한다.
create table if not exists public.parent_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  login_email text not null,
  display_name text not null,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, login_email)
);

create table if not exists public.parent_account_students (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_account_id uuid not null references public.parent_accounts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text not null default 'parent',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (parent_account_id, student_id)
);

create index if not exists parent_accounts_tenant_status_idx
  on public.parent_accounts (tenant_id, status, created_at);
create index if not exists parent_account_students_tenant_student_idx
  on public.parent_account_students (tenant_id, student_id);

alter table public.parent_accounts enable row level security;
alter table public.parent_account_students enable row level security;

-- 읽기 = 같은 지점의 원장·관리자 + 총괄만. 앱 판정 canManageParentAccountsRole
-- (src/features/shuttle/parent-access.ts)과 같은 범위다 — 한쪽만 넓히면 강사·뷰어가 PostgREST로
-- 학부모 이메일·연락처를 직접 읽는다(#92). 쓰기 정책은 없다(발급은 서버 액션이 service_role로).
drop policy if exists parent_accounts_tenant_read on public.parent_accounts;
create policy parent_accounts_tenant_read on public.parent_accounts
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (
      (select public.auth_system_role()) in ('master', 'admin')
      or (select public.is_super_admin(auth.uid()))
    )
  );

drop policy if exists parent_account_students_tenant_read on public.parent_account_students;
create policy parent_account_students_tenant_read on public.parent_account_students
  for select to authenticated
  using (
    tenant_id = (select public.auth_tenant_id())
    and (
      (select public.auth_system_role()) in ('master', 'admin')
      or (select public.is_super_admin(auth.uid()))
    )
  );

drop trigger if exists tg_parent_accounts_updated_at on public.parent_accounts;
create trigger tg_parent_accounts_updated_at
before update on public.parent_accounts
for each row execute function public.tg_set_updated_at();

-- 학부모 로그인 계정은 직원 명단(public.users)에 복사하지 않는다.
-- auth.users → public.users 미러(0001a·0075a)는 tenant_id만 있으면 누구든 직원으로 만든다 —
-- 그대로 두면 학부모가 직원관리 목록·직원 선택지에 섞이고 직원 셸로 로그인한다.
-- 본문은 0075a 그대로이고, account_type='parent' 조기 반환 한 줄만 더했다.
create or replace function public.tg_sync_user_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tenant        uuid;
  v_role_explicit public.system_role;
  v_name          text;
begin
  if new.raw_app_meta_data ->> 'account_type' = 'parent' then
    return new;
  end if;

  v_tenant := nullif(new.raw_app_meta_data ->> 'tenant_id', '')::uuid;
  v_role_explicit := nullif(new.raw_app_meta_data ->> 'system_role', '')::public.system_role;
  v_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    split_part(new.email, '@', 1)
  );

  if v_tenant is null then
    return new;
  end if;

  insert into public.users (id, tenant_id, email, display_name, system_role, status)
  values (
    new.id,
    v_tenant,
    new.email,
    v_name,
    coalesce(v_role_explicit, 'viewer'::public.system_role),
    'active'
  )
  on conflict (id) do update set
    tenant_id    = excluded.tenant_id,
    email        = excluded.email,
    display_name = coalesce(public.users.display_name, excluded.display_name),
    system_role  = coalesce(v_role_explicit, public.users.system_role);

  return new;
end;
$$;

-- 이 규칙 이전에 발급돼 직원 명단에 복사된 학부모 행을 걷어낸다.
delete from public.users u
using public.parent_accounts p
where p.auth_user_id = u.id and p.tenant_id = u.tenant_id;