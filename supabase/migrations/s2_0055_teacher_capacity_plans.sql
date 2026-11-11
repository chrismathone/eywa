-- s2_0055 — 강사 통합 기록: 이번 달 적정 담당 학생 수(배정 상한)와 근거
-- 출처: aywa-next s2_0016_teacher_hub_capacity.sql(복제본 전용 번호) → main 예약 번호 s2_0055.
-- 원장이 정하는 '계획 한도'이지 성과 점수가 아니다. 학생을 자동으로 배정하지 않는다.
-- 이번 달(한국 날짜) 것만 저장한다 — 지난 달 기준을 고치지 않는다. 같은 요청 번호로 다시 보내면 처음 결과를 돌려준다(두 번 저장 없음).
-- 서버 전용: 브라우저 정책 0개는 의도적이다(`src/features/teacher-hub/server.ts` — 원장 역할 + 원생·직원 열람 + 수업 평가 쓰기 권한).
-- 🔴 한 번만 실행. 되돌리기 = scripts/_oneoff/revert-s2_0055-teacher-capacity-plans.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.teacher_capacity_plans (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  max_students integer not null check (max_students between 0 and 2000),
  basis text not null check (length(btrim(basis)) between 2 and 1500),
  version integer not null check (version > 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, teacher_id, month)
);
create table public.teacher_capacity_events (
  request_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  teacher_id uuid not null references public.users(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  month text not null,
  version integer not null,
  request jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, teacher_id, month, version)
);
alter table public.teacher_capacity_plans enable row level security;
alter table public.teacher_capacity_events enable row level security;
revoke all on public.teacher_capacity_plans, public.teacher_capacity_events from public, anon, authenticated, service_role;
grant select, insert, update on public.teacher_capacity_plans to service_role;
grant select, insert on public.teacher_capacity_events to service_role;

create function public.save_teacher_capacity_plan(p_tenant uuid, p_actor uuid, p_teacher uuid, p_month text, p_expected integer,
  p_request uuid, p_max integer, p_basis text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare old public.teacher_capacity_plans; prior public.teacher_capacity_events; payload jsonb; n integer;
begin
  if not exists (select 1 from public.users where id = p_actor and tenant_id = p_tenant and system_role = 'master' and status = 'active')
     or not exists (select 1 from public.users where id = p_teacher and tenant_id = p_tenant) then
    raise exception 'access_denied';
  end if;
  if p_month is null or p_month <> to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM') or p_expected is null or p_expected < 0
     or p_request is null or p_max is null or p_max < 0 or p_max > 2000
     or coalesce(length(btrim(p_basis)), 0) < 2 or length(p_basis) > 1500 then
    raise exception 'invalid_plan';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_teacher::text || ':' || p_month, 0));
  payload := jsonb_build_object('teacher', p_teacher, 'month', p_month, 'expected', p_expected, 'max', p_max, 'basis', btrim(p_basis));
  select * into prior from public.teacher_capacity_events where request_id = p_request;
  if prior.request_id is not null then
    if prior.tenant_id <> p_tenant or prior.actor_id <> p_actor or prior.request <> payload then raise exception 'request_conflict'; end if;
    return jsonb_build_object('version', prior.version, 'month', prior.month);
  end if;
  select * into old from public.teacher_capacity_plans where tenant_id = p_tenant and teacher_id = p_teacher and month = p_month for update;
  if coalesce(old.version, 0) <> p_expected then raise exception 'version_conflict'; end if;
  n := p_expected + 1;
  insert into public.teacher_capacity_plans (tenant_id, teacher_id, month, max_students, basis, version, updated_by)
    values (p_tenant, p_teacher, p_month, p_max, btrim(p_basis), n, p_actor)
    on conflict (tenant_id, teacher_id, month) do update
      set max_students = excluded.max_students, basis = excluded.basis, version = excluded.version, updated_by = excluded.updated_by, updated_at = now();
  insert into public.teacher_capacity_events (request_id, tenant_id, teacher_id, actor_id, month, version, request)
    values (p_request, p_tenant, p_teacher, p_actor, p_month, n, payload);
  return jsonb_build_object('version', n, 'month', p_month);
end $$;
revoke all on function public.save_teacher_capacity_plan(uuid, uuid, uuid, text, integer, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.save_teacher_capacity_plan(uuid, uuid, uuid, text, integer, uuid, integer, text) to service_role;

commit;
