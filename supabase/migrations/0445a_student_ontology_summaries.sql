-- 학생 기록의 명시적 요약 저장. 승인 전 운영 DB에 적용하지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table if not exists public.student_ontology_summaries (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  requested_by uuid not null references public.users(id) on delete cascade,
  purpose text not null default 'recent_records' check (purpose = 'recent_records'),
  input_hash text check (input_hash ~ '^[a-f0-9]{64}$'),
  contract_version text,
  result jsonb check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 16384),
  model_label text,
  generated_at timestamptz,
  request_token uuid,
  requested_at timestamptz,
  primary key (tenant_id, student_id, requested_by, purpose)
);
alter table public.student_ontology_summaries enable row level security;
revoke all on public.student_ontology_summaries from public, anon, authenticated;
grant all on public.student_ontology_summaries to service_role;
create or replace function public.guard_student_ontology_summary() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists(select 1 from public.students where id=new.student_id and tenant_id=new.tenant_id)
     or not exists(select 1 from public.users where id=new.requested_by and tenant_id=new.tenant_id) then
    raise exception '요약할 학생과 요청자의 학원을 확인해 주세요';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_student_ontology_summary() from public, anon, authenticated;
drop trigger if exists guard_student_ontology_summary on public.student_ontology_summaries;
create trigger guard_student_ontology_summary before insert or update on public.student_ontology_summaries
  for each row execute function public.guard_student_ontology_summary();
comment on table public.student_ontology_summaries is '학생별 고정 목적의 Claude 발췌 요약. 요청자별 격리, 읽기 시 현재 원본·권한·해시 재검증. 페이지 조회에서 AI 호출 없음.';
-- Pilot spending control: atomic 20 attempts/tenant/KST day. Provider failures count too.
create table if not exists public.student_ontology_summary_daily_usage (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  usage_date date not null,
  attempts integer not null check (attempts between 1 and 20),
  primary key (tenant_id, usage_date)
);
alter table public.student_ontology_summary_daily_usage enable row level security;
revoke all on public.student_ontology_summary_daily_usage from public, anon, authenticated;
grant all on public.student_ontology_summary_daily_usage to service_role;
create or replace function public.reserve_student_ontology_summary_call(p_tenant uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
declare granted integer;
begin
  insert into public.student_ontology_summary_daily_usage(tenant_id, usage_date, attempts)
  values(p_tenant, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (tenant_id, usage_date) do update
    set attempts = student_ontology_summary_daily_usage.attempts + 1
    where student_ontology_summary_daily_usage.attempts < 20
  returning attempts into granted;
  return granted is not null;
end;
$$;
revoke all on function public.reserve_student_ontology_summary_call(uuid) from public, anon, authenticated;
grant execute on function public.reserve_student_ontology_summary_call(uuid) to service_role;
commit;
