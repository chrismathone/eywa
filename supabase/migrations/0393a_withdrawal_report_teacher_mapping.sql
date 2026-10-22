-- 기존 보고서 작성자를 한글·영어 이름으로 연결한다. 동명이인은 배정하지 않는다.
begin;
set local lock_timeout = '5s';
alter table public.withdrawal_report_archives add column if not exists mapped_teacher_id uuid references public.users(id) on delete set null;
create index if not exists withdrawal_report_archives_teacher_idx on public.withdrawal_report_archives(tenant_id,mapped_teacher_id,exit_date desc);

create or replace function public.withdrawal_teacher_aliases(value text) returns text[]
language sql immutable set search_path=public as $$
  select array_agg(distinct alias) from (
    select lower(regexp_replace(normalize(coalesce(value,''),NFKC),'[[:space:]]','','g')) as alias
    union all
    select lower(token) from regexp_split_to_table(normalize(coalesce(value,''),NFKC),'[[:space:]()/,·]+') token
  ) a where alias<>'';
$$;
create or replace function public.match_withdrawal_archive_teacher(p_tenant uuid,p_name text) returns uuid
language sql stable security invoker set search_path=public as $$
  -- 퇴사자까지 대조하여 같은 별명을 재사용한 계정에 옛 기록이 넘어가지 않게 한다.
  select case when count(*)=1 then (array_agg(id))[1] else null end
  from public.users
  where tenant_id=p_tenant and system_role::text<>'student'
    and (public.withdrawal_teacher_aliases(display_name) || coalesce(public.withdrawal_teacher_aliases(english_name),'{}'::text[]))
      && public.withdrawal_teacher_aliases(p_name);
$$;
create or replace function public.map_withdrawal_archive_teacher() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  new.mapped_teacher_id:=public.match_withdrawal_archive_teacher(new.tenant_id,new.teacher_name);
  return new;
end $$;
drop trigger if exists map_withdrawal_archive_teacher on public.withdrawal_report_archives;
create trigger map_withdrawal_archive_teacher before insert or update of teacher_name,tenant_id
on public.withdrawal_report_archives for each row execute function public.map_withdrawal_archive_teacher();
update public.withdrawal_report_archives set mapped_teacher_id=public.match_withdrawal_archive_teacher(tenant_id,teacher_name)
where mapped_teacher_id is null;
revoke all on function public.withdrawal_teacher_aliases(text),public.match_withdrawal_archive_teacher(uuid,text),public.map_withdrawal_archive_teacher() from public,anon,authenticated;
grant execute on function public.withdrawal_teacher_aliases(text),public.match_withdrawal_archive_teacher(uuid,text),public.map_withdrawal_archive_teacher() to service_role;
notify pgrst,'reload schema';
commit;
