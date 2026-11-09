-- Student loyalty: optional append-only 42-factor evidence. Existing totals and settings remain unchanged.
-- Append-only evidence. Access is through authenticated, tenant-scoped server actions.
create table public.student_contribution_factor_records (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 student_id uuid not null references public.students(id),
 month text not null check (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 factor_id text not null check (factor_id ~ '^F(0[1-9]|[1-3][0-9]|4[0-2])$'),
 value jsonb,
 state text not null check (state in ('measured','na','reset')),
 evidence text not null check (length(btrim(evidence)) between 3 and 2000),
 version integer not null check (version > 0),
 model_version text not null default 'contribution-factors-v1',
 actor_id uuid not null,
 recorded_at timestamptz not null default now(),
 unique (tenant_id,student_id,month,factor_id,version),
 check ((state='measured' and value is not null and jsonb_typeof(value) in ('number','string')) or (state <> 'measured' and value is null))
);
alter table public.student_contribution_factor_records enable row level security;
revoke all on public.student_contribution_factor_records from public, anon, authenticated;
grant select, insert on public.student_contribution_factor_records to service_role;
create function public.check_contribution_factor_record() returns trigger language plpgsql
set search_path = '' as $$
begin
 if tg_op <> 'INSERT' then raise exception '수정 이력은 새 기록으로 남겨 주세요'; end if;
 if not exists (select 1 from public.students where id=new.student_id and tenant_id=new.tenant_id and not coalesce(is_test,false)) then
   raise exception '학생과 지점을 확인해 주세요';
 end if;
 -- Serializes editors for this student. Version uniqueness also protects stale writes.
 perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text||new.student_id::text,0));
 if new.version <> coalesce((select max(version) from public.student_contribution_factor_records
   where tenant_id=new.tenant_id and student_id=new.student_id and month=new.month and factor_id=new.factor_id),0)+1 then
   raise exception '다른 기록이 먼저 저장되었습니다. 새로고침 후 다시 입력해 주세요';
 end if;
 return new;
end $$;
revoke all on function public.check_contribution_factor_record() from public,anon,authenticated;
create trigger contribution_factor_record_check before insert or update or delete on public.student_contribution_factor_records
for each row execute function public.check_contribution_factor_record();
comment on table public.student_contribution_factor_records is 'Student-linked 42-factor observations, evidence and immutable versions; no sample workbook data';

-- Supabase default privileges include ALL for service_role; narrow explicitly.
revoke all on public.student_contribution_factor_records from service_role;
grant select, insert on public.student_contribution_factor_records to service_role;
create index student_contribution_factor_student_idx on public.student_contribution_factor_records(student_id);
