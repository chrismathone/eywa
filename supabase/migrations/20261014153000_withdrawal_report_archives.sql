begin;
set local lock_timeout='5s';
create table public.withdrawal_report_sources (
 tenant_id uuid not null references public.tenants(id) on delete cascade, spreadsheet_id text not null, sheet_id bigint not null,
 sheet_title text not null, hidden boolean not null, grid jsonb not null, imported_at timestamptz not null default now(),
 primary key(tenant_id,spreadsheet_id,sheet_id)
);
create table public.withdrawal_report_archives (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 spreadsheet_id text not null, source_key text not null, sheet_id bigint not null, sheet_title text not null, source_range text not null,
 student_name text not null, school_grade text not null, class_name text not null, subject text, exit_date date, raw_exit_date text not null,
 teacher_name text not null, fields jsonb not null, signatures jsonb not null, raw_grid jsonb not null,
 mapped_student_id uuid references public.students(id) on delete restrict, mapping_kind text not null default 'unmapped' check(mapping_kind in ('auto','manual','unmapped')),
 mapping_evidence jsonb not null default '{}', revision integer not null default 1, imported_at timestamptz not null default now(),
 unique(tenant_id,spreadsheet_id,source_key)
);
create table public.withdrawal_report_archive_mappings (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id) on delete cascade,
 archive_id uuid not null references public.withdrawal_report_archives(id) on delete cascade, actor_id uuid not null references public.users(id),
 previous_student_id uuid, student_id uuid, created_at timestamptz not null default now()
);
alter table public.withdrawal_report_sources enable row level security;
alter table public.withdrawal_report_archives enable row level security;
alter table public.withdrawal_report_archive_mappings enable row level security;
revoke all on public.withdrawal_report_sources,public.withdrawal_report_archives,public.withdrawal_report_archive_mappings from public,anon,authenticated;
grant select,insert,update on public.withdrawal_report_sources,public.withdrawal_report_archives to service_role;
grant select,insert on public.withdrawal_report_archive_mappings to service_role;
create index withdrawal_report_archives_tenant_date on public.withdrawal_report_archives(tenant_id,exit_date desc);
create function public.map_withdrawal_report_archive(p_tenant uuid,p_actor uuid,p_archive uuid,p_student uuid,p_revision integer) returns uuid
language plpgsql security invoker set search_path=public as $$
declare a public.withdrawal_report_archives; actor public.users; scope_row jsonb;
begin
 select * into actor from public.users where id=p_actor and tenant_id=p_tenant and status='active';
 if actor.id is null or actor.system_role::text not in ('admin','manager','master') then raise exception '기존 기록을 연결할 권한이 없습니다.'; end if;
 select * into a from public.withdrawal_report_archives where id=p_archive and tenant_id=p_tenant for update;
 if a.id is null then raise exception '기록을 찾을 수 없습니다.'; end if;
 if a.revision<>p_revision then raise exception '연결 정보가 변경되었습니다. 새로고침 후 다시 진행해 주세요.'; end if;
 if actor.system_role::text<>'master' and not coalesce(public.is_super_admin(actor.id),false) and a.subject is not null then
  select x into scope_row from public.tenant_settings ts,lateral jsonb_array_elements(coalesce(ts.data#>'{permissions,specialAccess,staffSubjectScopes}','[]')) x where ts.tenant_id=p_tenant and x->>'userId'=actor.id::text limit 1;
  if scope_row is not null and not coalesce(scope_row->'subjects','[]') ? a.subject then raise exception '담당 과목의 기록만 연결할 수 있습니다.'; end if;
 end if;
 if p_student is not null and not exists(select 1 from public.students where id=p_student and tenant_id=p_tenant) then raise exception '이 지점의 학생을 선택해 주세요.'; end if;
 insert into public.withdrawal_report_archive_mappings(tenant_id,archive_id,actor_id,previous_student_id,student_id) values(p_tenant,a.id,p_actor,a.mapped_student_id,p_student);
 update public.withdrawal_report_archives set mapped_student_id=p_student,mapping_kind='manual',revision=revision+1 where id=a.id;
 return a.id;
end $$;
revoke all on function public.map_withdrawal_report_archive(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.map_withdrawal_report_archive(uuid,uuid,uuid,uuid,integer) to service_role;
commit;
