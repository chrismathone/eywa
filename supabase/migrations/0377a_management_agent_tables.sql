-- Management follow-up pilot. Additive; default OFF. Apply 0377a..e together before enabling.
begin;
set local lock_timeout = '5s';
create table public.management_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  consultation_id uuid not null,
  student_id uuid not null,
  source_counselor_id uuid,
  assignee_id uuid,
  source_due_on date not null,
  source_done boolean not null default false,
  status text not null default 'open' check (status in ('open','in_progress','waiting_review','resolved','dismissed','blocked')),
  episode integer not null default 1 check (episode > 0),
  version integer not null default 1 check (version > 0),
  result_kind text check (result_kind in ('contacted','retry','decision')),
  result_note text check (length(result_note) <= 1000),
  verification_note text check (length(verification_note) <= 1000),
  acknowledged_at timestamptz,
  next_check_on date,
  last_checked_at timestamptz not null default now(),
  last_reminded_on date,
  announced boolean not null default false,
  ai_advice jsonb,
  ai_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, consultation_id),
  unique (tenant_id, id)
);
create index management_cases_queue on public.management_cases (tenant_id, status, source_due_on);
create table public.management_case_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null,
  event_key text not null,
  kind text not null,
  actor_id uuid,
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, case_id) references public.management_cases(tenant_id, id) on delete cascade,
  unique (tenant_id, case_id, event_key)
);
create index management_case_events_timeline on public.management_case_events (tenant_id, case_id, created_at);
create table public.management_notion_outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  case_id uuid not null,
  version integer not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','uncertain','failed')),
  page_id text,
  attempts integer not null default 0,
  error_code text,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, case_id) references public.management_cases(tenant_id, id) on delete cascade,
  unique (tenant_id, case_id)
);
create index management_notion_pending on public.management_notion_outbox (tenant_id, status, updated_at);
alter table public.management_cases enable row level security;
alter table public.management_case_events enable row level security;
alter table public.management_notion_outbox enable row level security;
revoke all on public.management_cases, public.management_case_events, public.management_notion_outbox from anon, authenticated;
grant select on public.management_cases, public.management_case_events to authenticated;
grant all on public.management_cases, public.management_case_events, public.management_notion_outbox to service_role;
commit;
