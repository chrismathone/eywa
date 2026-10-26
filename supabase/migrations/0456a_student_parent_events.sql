-- Expand-only. Applying this migration neither imports attendance nor enables scoring.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table public.student_parent_event_imports (
  tenant_id uuid not null references public.tenants(id),
  id uuid not null default gen_random_uuid(),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  policy_version text not null,
  status text not null check (status in ('applied','revoked')),
  scoring_approved_at timestamptz,
  approved_by uuid not null references public.users(id),
  approved_at timestamptz not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  primary key (tenant_id,id), unique (tenant_id,fingerprint)
);
create table public.student_parent_events (
  tenant_id uuid not null references public.tenants(id),
  id text not null,
  title text not null check (length(title) between 1 and 300),
  event_date date not null,
  session text not null default '',
  status text not null default 'active' check (status in ('active','cancelled')),
  import_id uuid not null,
  primary key (tenant_id,id), unique (tenant_id,event_date,title,session),
  foreign key (tenant_id,import_id) references public.student_parent_event_imports(tenant_id,id)
);
create table public.student_parent_event_registrations (
  tenant_id uuid not null,
  id text not null check (id ~ '^[0-9a-f]{64}$'),
  event_id text not null,
  identity_hash text not null check (identity_hash ~ '^[0-9a-f]{64}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  source_file text not null,
  source_sheet bigint not null,
  source_row integer not null check (source_row > 0),
  source_ref text not null check (source_ref ~ '^https://docs[.]google[.]com/spreadsheets/d/[a-zA-Z0-9_-]+/'),
  state text not null check (state in ('recognized','cancelled','review','scheduled')),
  attendance_basis text not null check (attendance_basis in ('explicit_attendance','registration_policy','unconfirmed','cancellation','future_event')),
  check ((state = 'recognized') = (attendance_basis in ('explicit_attendance','registration_policy'))),
  import_id uuid not null,
  primary key (tenant_id,id),
  foreign key (tenant_id,event_id) references public.student_parent_events(tenant_id,id),
  foreign key (tenant_id,import_id) references public.student_parent_event_imports(tenant_id,id)
);
-- Original rows are private, immutable evidence. A new hash creates a new revision.
create table public.student_parent_event_revisions (
  tenant_id uuid not null, registration_id text not null, content_hash text not null,
  raw jsonb not null, source_ref text not null, read_at timestamptz not null, import_id uuid not null,
  primary key (tenant_id,registration_id,content_hash),
  foreign key (tenant_id,registration_id) references public.student_parent_event_registrations(tenant_id,id),
  foreign key (tenant_id,import_id) references public.student_parent_event_imports(tenant_id,id)
);
create table public.student_parent_event_recognitions (
  tenant_id uuid not null, event_id text not null,
  student_id uuid not null references public.students(id),
  family_key text not null check (family_key ~ '^[0-9a-f]{64}$'),
  basis text not null check (basis in ('direct','household','sibling')),
  source_ids text[] not null check (cardinality(source_ids) > 0),
  state text not null default 'recognized' check (state in ('recognized','cancelled')),
  import_id uuid not null,
  primary key (tenant_id,event_id,student_id),
  foreign key (tenant_id,event_id) references public.student_parent_events(tenant_id,id),
  foreign key (tenant_id,import_id) references public.student_parent_event_imports(tenant_id,id)
);
create index student_parent_event_student_idx on public.student_parent_event_recognitions(tenant_id,student_id);
create index student_parent_event_date_idx on public.student_parent_events(tenant_id,event_date);

create function public.guard_student_parent_event_source_identity() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.tenant_id,new.id,new.event_id,new.identity_hash) is distinct from (old.tenant_id,old.id,old.event_id,old.identity_hash) then
    raise exception '기존 설명회 신청의 연결 대상은 바꿀 수 없습니다';
  end if;
  return new;
end; $$;
create trigger student_parent_event_source_identity_guard before update on public.student_parent_event_registrations
  for each row execute function public.guard_student_parent_event_source_identity();

create function public.guard_student_parent_event_recognition() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists(select 1 from public.students where id = new.student_id and tenant_id = new.tenant_id) then
    raise exception '학생과 설명회의 학원 정보를 확인해 주세요';
  end if;
  if exists(select 1 from unnest(new.source_ids) x where not exists (
    select 1 from public.student_parent_event_registrations r
    where r.tenant_id = new.tenant_id and r.id = x and r.event_id = new.event_id
      and (new.state = 'cancelled' or r.state = 'recognized'))) then
    raise exception '설명회 신청 근거를 확인해 주세요';
  end if;
  return new;
end; $$;
create trigger student_parent_event_recognition_guard before insert or update on public.student_parent_event_recognitions
  for each row execute function public.guard_student_parent_event_recognition();

-- Old applications may omit the new metric. Validate it only when present; never rewrite closed months.
create function public.guard_student_parent_event_metric() returns trigger
language plpgsql set search_path = public as $$
declare part jsonb;
begin
  foreach part in array array[new.raws,new.correction] loop
    if part ? 'parentSeminarEvents' and (jsonb_typeof(part->'parentSeminarEvents') <> 'number'
      or (part->>'parentSeminarEvents') !~ '^-?[0-9]+$' or abs((part->>'parentSeminarEvents')::numeric) > 9007199254740991) then
      raise exception '설명회 참석 수치를 확인해 주세요';
    end if;
  end loop;
  return new;
end; $$;
create trigger student_parent_event_metric_guard before insert or update on public.student_contribution_months
  for each row execute function public.guard_student_parent_event_metric();

alter table public.student_parent_event_imports enable row level security;
alter table public.student_parent_events enable row level security;
alter table public.student_parent_event_registrations enable row level security;
alter table public.student_parent_event_revisions enable row level security;
alter table public.student_parent_event_recognitions enable row level security;
revoke all on public.student_parent_event_imports, public.student_parent_events, public.student_parent_event_registrations,
  public.student_parent_event_revisions, public.student_parent_event_recognitions from public, anon, authenticated;
grant all on public.student_parent_event_imports, public.student_parent_events, public.student_parent_event_registrations,
  public.student_parent_event_revisions, public.student_parent_event_recognitions to service_role;
-- Preserve historical import evidence, even for the server role.
revoke all on public.student_parent_event_revisions from service_role;
grant select, insert on public.student_parent_event_revisions to service_role;
comment on table public.student_parent_event_recognitions is '학생별 설명회 기여 실적. 형제 각각 인정, 같은 학생·행사는 한 번. 현재 인정 집합으로 매번 재계산.';

-- A single statement snapshot prevents a concurrent import/cancellation from mixing source versions.
create function public.student_parent_event_snapshot(p_tenant uuid, p_students uuid[] default null, p_month text default null) returns jsonb
language sql stable security invoker set search_path = public as $$
with active as (
  select r.*, e.title, e.event_date from public.student_parent_event_recognitions r
  join public.student_parent_events e on (e.tenant_id,e.id) = (r.tenant_id,r.event_id)
  join public.student_parent_event_imports i on (i.tenant_id,i.id) = (r.tenant_id,r.import_id)
  where r.tenant_id = p_tenant and r.state = 'recognized' and e.status = 'active' and i.status = 'applied'
    and (p_students is null or r.student_id = any(p_students))
    and (p_month is null or to_char(e.event_date,'YYYY-MM') = p_month)
), prepared as (
  select a.*, (select array_agg(s.id order by s.id) from public.student_parent_event_registrations s
    join public.student_parent_event_imports i on (i.tenant_id,i.id) = (s.tenant_id,s.import_id)
    where s.tenant_id = a.tenant_id and s.event_id = a.event_id and s.id = any(a.source_ids)
      and s.state = 'recognized' and i.status = 'applied') as valid_sources
  from active a
)
select jsonb_build_object(
  'ready', exists(select 1 from public.student_parent_event_imports where tenant_id = p_tenant),
  'pendingRows', coalesce((select sum(coalesce((summary->>'pendingRows')::int,0)) from public.student_parent_event_imports where tenant_id = p_tenant and status = 'applied'),0),
  'coverageFrom', (select min(e.event_date) from public.student_parent_events e join public.student_parent_event_imports i on i.tenant_id=e.tenant_id and i.id=e.import_id where e.tenant_id=p_tenant and i.status='applied'),
  'checkedAt', (select max(created_at) from public.student_parent_event_imports where tenant_id = p_tenant),
  'valid', not exists(select 1 from active a, unnest(a.source_ids) sid where not exists (
    select 1 from public.student_parent_event_registrations s where s.tenant_id = a.tenant_id and s.id = sid and s.event_id = a.event_id)),
  'records', coalesce((select jsonb_agg(jsonb_build_object(
    'tenantId', p.tenant_id, 'eventId', p.event_id, 'eventDate', p.event_date, 'title', p.title,
    'studentId', p.student_id, 'familyKey', p.family_key, 'basis', p.basis, 'sourceIds', p.valid_sources,
    'attendanceBasis', case when exists(select 1 from public.student_parent_event_registrations s
      where s.tenant_id = p.tenant_id and s.id = any(p.valid_sources) and s.attendance_basis = 'explicit_attendance')
      then 'explicit_attendance' else 'registration_policy' end) order by p.event_id,p.student_id)
    from prepared p where cardinality(p.valid_sources) > 0), '[]'::jsonb)
); $$;
revoke all on function public.student_parent_event_snapshot(uuid,uuid[],text) from public, anon, authenticated;
grant execute on function public.student_parent_event_snapshot(uuid,uuid[],text) to service_role;
commit;
