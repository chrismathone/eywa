-- 연습본 적용 예약: 운영 자료를 예약 시점에 바꾸지 않고 KST 정시에 한 트랜잭션으로 적용한다.
create table if not exists public.timetable_lab_apply_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  actor_role text not null,
  policy_hash text not null,
  request_hash text not null,
  baseline_hash text not null,
  apply_at timestamptz not null,
  effective_date date not null,
  payload jsonb not null,
  summary jsonb not null,
  status text not null default 'pending' check (status in ('pending','applied','failed','cancelled')),
  error text,
  result jsonb,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (extract(minute from apply_at) = 0 and extract(second from apply_at) = 0),
  check (effective_date = (apply_at at time zone 'Asia/Seoul')::date)
);
create unique index if not exists timetable_lab_apply_jobs_pending_once_idx on public.timetable_lab_apply_jobs(tenant_id,actor_id,request_hash,apply_at) where status='pending';
create index if not exists timetable_lab_apply_jobs_due_idx on public.timetable_lab_apply_jobs(apply_at,id) where status='pending';
create index if not exists timetable_lab_apply_jobs_tenant_idx on public.timetable_lab_apply_jobs(tenant_id,created_at desc);
alter table public.timetable_lab_apply_jobs enable row level security;
revoke all on public.timetable_lab_apply_jobs from anon, authenticated;
grant select on public.timetable_lab_apply_jobs to authenticated;
grant all on public.timetable_lab_apply_jobs to service_role;
drop policy if exists timetable_lab_apply_jobs_own_read on public.timetable_lab_apply_jobs;
create policy timetable_lab_apply_jobs_own_read on public.timetable_lab_apply_jobs for select to authenticated
  using (tenant_id = public.auth_tenant_id() and actor_id = auth.uid());
