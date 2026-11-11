-- s2_0052 — 경영 분석: ECOUNT 회계 자료 · 원본 대사(대조) 기록 · 확인 이력
-- 출처: aywa-next 복제본(archive/aywa-next-375d27d) 20261101122124 · 20261101122539 · 20261101133830 · 20261101135011 을 한 파일로.
--   복제본 전용이던 것(크론·복제본 배포 가정)은 없다. 기존 표·함수는 건드리지 않는다(새 표 4개 · 새 함수 2개만).
--
-- 흐름: ECOUNT 손익계산서 .xlsx / 계정별원장 .csv → 원장이 기간·분류를 검토해 저장(버전마다 이력) →
--   MakeEdu 수납통합내역·ECOUNT 월별손익분석과 에이와 집계를 대조한 결과를 '바뀌지 않는 기록'으로 저장 → 확인 업무(상태·담당·기한·메모)를 버전으로 덧붙인다.
--   대조 기록·확인 이력은 청구를 고치거나 회계 마감을 확정하지 않는다.
-- 서버 전용: 브라우저 읽기/쓰기 정책 0개는 의도적이다(s2_0028과 같은 규약 — admin 클라이언트 + tenant_id 필터).
--   문은 앱(`src/features/management/server/access.ts` — 원장 역할 + 경영 분석·수납·원생·직원 권한)이 가르고,
--   저장 함수가 한 번 더 '그 지점의 재직 중 원장'인지 본다.
-- 기록·이력 표는 덧붙이기만 한다(service_role에도 update·delete 없음 — Supabase 기본 권한을 먼저 걷는다).
-- 🔴 한 번만 실행(create table·function에 if not exists가 없다 — 다시 실행하면 오류로 멈춘다 · 트랜잭션이라 데이터는 안전).
-- 되돌리기 = scripts/_oneoff/revert-s2_0052-management-accounting.sql(앱을 먼저 되돌린 뒤 · 저장한 회계 자료·대조 기록이 함께 사라진다).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ── 회계 자료(기간마다 한 줄 + 버전 이력) ─────────────────────────────────────────────────
create table public.management_accounting_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  document jsonb not null,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  constraint management_accounting_period_unique unique (tenant_id, period_start, period_end),
  check (period_end >= period_start),
  check (jsonb_typeof(document) = 'object'),
  check (document->>'start' = period_start::text and document->>'end' = period_end::text),
  check (document->>'scopeConfirmed' = 'true'),
  check (document->>'sourceHash' ~ '^[a-f0-9]{64}$')
);
create table public.management_accounting_versions (
  report_id uuid not null references public.management_accounting_reports(id) on delete cascade,
  version integer not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document jsonb not null,
  actor_id uuid not null references public.users(id),
  recorded_at timestamptz not null default now(),
  primary key (report_id, version)
);
create index management_accounting_versions_tenant_idx on public.management_accounting_versions (tenant_id);

-- ── 원본 대조 기록(바뀌지 않음) · 확인 이력(버전으로 덧붙임) ─────────────────────────────
create table public.management_source_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null check (source in ('ecount', 'makeedu')),
  month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  compared_hash text not null check (compared_hash ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and jsonb_typeof(evidence->'issues') = 'array'),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (tenant_id, source, month, source_hash, compared_hash),
  unique (id, tenant_id),
  check (evidence->>'source' = source and evidence->>'month' = month and evidence->>'sourceHash' = source_hash and evidence->>'comparedHash' = compared_hash)
);
create index management_source_batches_month_idx on public.management_source_batches (tenant_id, month, created_at desc);
create table public.management_review_events (
  batch_id uuid not null,
  tenant_id uuid not null,
  issue_key text not null check (issue_key ~ '^[a-z0-9_-]{1,80}$'),
  version integer not null check (version > 0),
  actor_id uuid not null references public.users(id),
  status text not null check (status in ('open', 'reviewing', 'waiting', 'recheck')),
  owner text not null check (length(owner) <= 80),
  due_date date,
  note text not null check (length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  primary key (batch_id, issue_key, version),
  foreign key (batch_id, tenant_id) references public.management_source_batches(id, tenant_id) on delete cascade
);
create index management_review_events_tenant_idx on public.management_review_events (tenant_id, batch_id);

alter table public.management_accounting_reports enable row level security;
alter table public.management_accounting_versions enable row level security;
alter table public.management_source_batches enable row level security;
alter table public.management_review_events enable row level security;
revoke all on public.management_accounting_reports, public.management_accounting_versions,
  public.management_source_batches, public.management_review_events from public, anon, authenticated, service_role;
grant select, insert, update on public.management_accounting_reports to service_role;
grant select, insert on public.management_accounting_versions, public.management_source_batches, public.management_review_events to service_role;

-- ── 회계 자료 저장: 같은 지점·기간은 직렬로 · 같은 내용이면 그대로 · 버전이 다르면 거절 · 바뀔 때마다 이력 ─────
create function public.save_management_accounting(p_tenant uuid, p_actor uuid, p_document jsonb, p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare current_row public.management_accounting_reports; start_date date; end_date date;
begin
  if not exists (select 1 from public.users where id = p_actor and tenant_id = p_tenant and system_role = 'master' and status = 'active') then
    raise exception 'management_access_denied';
  end if;
  start_date := (p_document->>'start')::date;
  end_date := (p_document->>'end')::date;
  if p_expected_version is null or p_expected_version < 0 or start_date is null or end_date is null
     or p_document->>'scopeConfirmed' is distinct from 'true' or jsonb_typeof(p_document->'complete') is distinct from 'boolean' then
    raise exception 'invalid_management_document';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || start_date::text || end_date::text, 0));
  select * into current_row from public.management_accounting_reports
    where tenant_id = p_tenant and period_start = start_date and period_end = end_date for update;
  if found then
    if current_row.document = p_document then
      return jsonb_build_object('id', current_row.id, 'version', current_row.version, 'unchanged', true);
    end if;
    if current_row.version <> p_expected_version then raise exception 'version_conflict'; end if;
    update public.management_accounting_reports
      set document = p_document, version = version + 1, updated_by = p_actor, updated_at = now()
      where id = current_row.id and tenant_id = p_tenant returning * into current_row;
  else
    if p_expected_version <> 0 then raise exception 'version_conflict'; end if;
    insert into public.management_accounting_reports (tenant_id, period_start, period_end, document, updated_by)
      values (p_tenant, start_date, end_date, p_document, p_actor) returning * into current_row;
  end if;
  insert into public.management_accounting_versions (report_id, version, tenant_id, document, actor_id)
    values (current_row.id, current_row.version, p_tenant, p_document, p_actor);
  return jsonb_build_object('id', current_row.id, 'version', current_row.version, 'unchanged', false);
end $$;
revoke all on function public.save_management_accounting(uuid, uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_management_accounting(uuid, uuid, jsonb, integer) to service_role;

-- ── 확인 이력 덧붙이기: 그 지점 기록의 실제 확인 항목만 · 버전 비교로 동시 기록 덮어쓰기를 막는다 ─────────────
create function public.append_management_review(p_tenant uuid, p_actor uuid, p_batch uuid, p_issue text, p_expected integer,
  p_status text, p_owner text, p_due date, p_note text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare current_version integer;
begin
  if not exists (select 1 from public.users where id = p_actor and tenant_id = p_tenant and system_role = 'master' and status = 'active') then
    raise exception 'management_access_denied';
  end if;
  if p_expected is null or p_expected < 0 or p_status is null or p_status not in ('open', 'reviewing', 'waiting', 'recheck')
     or p_owner is null or length(p_owner) > 80 or p_note is null or length(btrim(p_note)) not between 1 and 2000 then
    raise exception 'invalid_review';
  end if;
  if not exists (select 1 from public.management_source_batches b cross join lateral jsonb_array_elements(b.evidence->'issues') i
                 where b.id = p_batch and b.tenant_id = p_tenant and i->>'key' = p_issue) then
    raise exception 'review_issue_not_found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_batch::text || p_issue, 0));
  select coalesce(max(version), 0) into current_version from public.management_review_events
    where batch_id = p_batch and tenant_id = p_tenant and issue_key = p_issue;
  if current_version <> p_expected then raise exception 'version_conflict'; end if;
  insert into public.management_review_events (batch_id, tenant_id, issue_key, version, actor_id, status, owner, due_date, note)
    values (p_batch, p_tenant, p_issue, current_version + 1, p_actor, p_status, btrim(p_owner), p_due, btrim(p_note));
  return current_version + 1;
end $$;
revoke all on function public.append_management_review(uuid, uuid, uuid, text, integer, text, text, date, text) from public, anon, authenticated;
grant execute on function public.append_management_review(uuid, uuid, uuid, text, integer, text, text, date, text) to service_role;

commit;
