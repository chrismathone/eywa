-- Both goal stores must commit or roll back together. Callable only by the server.
begin;

create or replace function public.reset_mcs_learning_goals(
  p_tenant_id uuid,
  p_class_id uuid,
  p_student_ids uuid[],
  p_track text,
  p_start_date date,
  p_standard boolean
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  removed integer := 0;
  affected integer := 0;
begin
  if p_tenant_id is null or p_class_id is null or p_start_date is null
    or p_standard is null or p_track is null or p_track not in ('regular', 'supplement')
    or p_student_ids is null or cardinality(p_student_ids) not between 1 and 100
    or array_position(p_student_ids, null) is not null then
    raise exception '초기화할 대상을 확인해 주세요.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.classes where id = p_class_id and tenant_id = p_tenant_id and subject = 'math') then
    raise exception '반을 확인해 주세요.' using errcode = '22023';
  end if;

  -- Support installations that do not have one of the historical goal stores.
  if p_standard and pg_catalog.to_regclass('public.math_learning_track_goals') is not null then
    delete from public.math_learning_track_goals
      where tenant_id = p_tenant_id and class_id = p_class_id
        and student_id = any(p_student_ids) and track = p_track and start_date = p_start_date;
    get diagnostics affected = row_count;
    removed := removed + affected;
  end if;
  if p_track = 'regular' and pg_catalog.to_regclass('public.math_learning_goals') is not null then
    delete from public.math_learning_goals
      where tenant_id = p_tenant_id and class_id = p_class_id and student_id = any(p_student_ids);
    get diagnostics affected = row_count;
    removed := removed + affected;
  end if;
  return removed;
end;
$$;

revoke all on function public.reset_mcs_learning_goals(uuid, uuid, uuid[], text, date, boolean) from public, anon, authenticated;
grant execute on function public.reset_mcs_learning_goals(uuid, uuid, uuid[], text, date, boolean) to service_role;
comment on function public.reset_mcs_learning_goals(uuid, uuid, uuid[], text, date, boolean)
  is 'Server-only atomic MCS goal reset; caller must enforce the existing MCS reset gate.';
notify pgrst, 'reload schema';
commit;
