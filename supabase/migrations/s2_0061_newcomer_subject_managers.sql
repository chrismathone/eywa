-- s2_0061 — 신규생 관리 담당자(30·60·90일 콜 책임자)를 학생·과목마다 (aywa-next 인계본 이식)
-- ✅ 운영 적용 2026-11-11(트랜잭션 ROLLBACK 검증 뒤 적용 · 표·정책 0개·함수·트리거 확인).
-- 인계본 원래 이름 20261103054427_newcomer_subject_managers.sql. s2_0060 뒤에 적용(그 파일의 검증·이력 트리거 함수를 쓴다).
-- 서버 전용(정책 0개 · admin + tenant_id 필터 — s2_0060과 같은 규약). 학생이 지워지면 배정도 함께 지운다.
-- 과목별 기본 담당(student_onboarding_manager_defaults)은 화면이 읽기만 한다 — 비어 있으면 '설정 없음'으로 보인다.
-- 🔴 한 번만 실행. 되돌리기: scripts/_oneoff/revert-s2_0061-newcomer-subject-managers.sql
begin;
set local statement_timeout = '60s';

create table public.student_onboarding_manager_defaults (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subject text not null check (subject ~ '^[a-z][a-z0-9_]{0,31}$'),
  manager_id uuid not null references public.users(id),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, subject)
);
create table public.student_onboarding_subject_assignments (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  subject text not null check (subject = '' or subject ~ '^[a-z][a-z0-9_]{0,31}$'),
  mode text not null check (mode in ('default','manual')),
  manager_id uuid references public.users(id),
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, student_id, subject),
  check (mode <> 'default' or manager_id is null)
);
create index onboarding_subject_manager on public.student_onboarding_subject_assignments (tenant_id, manager_id);

alter table public.student_onboarding_manager_defaults enable row level security;
alter table public.student_onboarding_subject_assignments enable row level security;
revoke all on public.student_onboarding_manager_defaults, public.student_onboarding_subject_assignments from public, anon, authenticated;
grant select, insert, update on public.student_onboarding_manager_defaults, public.student_onboarding_subject_assignments to service_role;

create function public.validate_onboarding_subject_manager() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.users where id = new.updated_by and tenant_id = new.tenant_id) then
    raise exception '담당자 소속을 확인해 주세요' using errcode = '23514';
  end if;
  if new.manager_id is not null and not exists (select 1 from public.users where id = new.manager_id and tenant_id = new.tenant_id
      and status = 'active' and system_role in ('master','admin','manager','counselor')) then
    raise exception '현재 학원의 관리 담당자를 선택해 주세요' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.tenant_id <> old.tenant_id or new.subject <> old.subject) then
    raise exception '학원과 과목은 변경할 수 없습니다' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.validate_onboarding_subject_manager() from public, anon, authenticated;
grant execute on function public.validate_onboarding_subject_manager() to service_role;

create trigger onboarding_subject_validate before insert or update on public.student_onboarding_subject_assignments
  for each row execute function public.validate_onboarding_followup();
create trigger onboarding_subject_manager_validate before insert or update on public.student_onboarding_subject_assignments
  for each row execute function public.validate_onboarding_subject_manager();
create trigger onboarding_default_manager_validate before insert or update on public.student_onboarding_manager_defaults
  for each row execute function public.validate_onboarding_subject_manager();
create trigger onboarding_subject_audit after insert or update on public.student_onboarding_subject_assignments
  for each row execute function public.audit_onboarding_followup();

notify pgrst, 'reload schema';
commit;
