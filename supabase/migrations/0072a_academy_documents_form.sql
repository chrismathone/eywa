-- 0072a_academy_documents_form.sql (손수 alpha)
-- 웹 작성 폼 문서(kind='form') — 직원 이력서 등 정형 서식을 앱에서 작성해 데이터베이스에 저장.
--   form_type: 폼 종류('staff_resume' 등) / form_data: 구조화 필드(jsonb) / restricted: 사무실 전용 열람.
-- restricted 행(주민번호·급여 등 민감 HR 문서)은 DB 레벨에서도 사무실 역할만 보이게 restrictive 정책 추가.

alter table academy_documents add column if not exists form_type text;
alter table academy_documents add column if not exists form_data jsonb;
alter table academy_documents add column if not exists restricted boolean not null default false;

alter table academy_documents drop constraint if exists academy_documents_kind_check;
alter table academy_documents add constraint academy_documents_kind_check
  check (kind in ('file', 'text', 'form'));

-- 호출자 system_role 해석(security definer — RLS 재귀 없이 users 조회). auth_tenant_id(0001a) 패턴.
create or replace function public.auth_system_role() returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select system_role::text from public.users where id = auth.uid()
$$;
revoke all on function public.auth_system_role() from public;
grant execute on function public.auth_system_role() to authenticated, service_role;

-- restrictive = 기존 tenant_isolation(permissive)과 AND. restricted=false 행은 전 직원 그대로,
-- restricted=true 행은 사무실 역할(master/admin/manager/accountant = staff 쓰기 기본 역할)만.
-- ⚠️ 역할 목록은 하드코딩 = 거친 백스톱(DB 레벨). 앱 레이어는 권한 매트릭스(canWriteTenant)를 따른다.
drop policy if exists academy_documents_restricted_guard on academy_documents;
create policy academy_documents_restricted_guard on academy_documents
  as restrictive
  for all
  using (
    restricted is not true
    or public.auth_system_role() in ('master', 'admin', 'manager', 'accountant')
  );
