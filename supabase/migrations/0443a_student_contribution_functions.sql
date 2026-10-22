begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- 중복 집계와 오래 걸린 옛 작업의 뒤늦은 저장을 막는다. 20분 후 새 작업이 인수한다.
create or replace function public.claim_student_contribution_refresh(p_tenant uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare token uuid := gen_random_uuid(); claimed uuid;
begin
  insert into public.student_contribution_settings(tenant_id) values (p_tenant) on conflict do nothing;
  update public.student_contribution_settings set refresh_token = token, refresh_started_at = now()
    where tenant_id = p_tenant and (refresh_token is null or refresh_started_at < now() - interval '20 minutes') returning refresh_token into claimed;
  return claimed;
end; $$;
create or replace function public.save_student_contribution_months(p_tenant uuid, p_token uuid, p_revision bigint, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare row record; config_row public.student_contribution_settings; written integer := 0; changed integer;
begin
  select * into config_row from public.student_contribution_settings where tenant_id = p_tenant for update;
  if config_row.refresh_token is distinct from p_token or p_token is null or config_row.revision <> p_revision then
    raise exception '집계 조건이 바뀌었습니다. 다시 집계해 주세요';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250 then raise exception '저장할 자료의 범위를 확인해 주세요'; end if;
  for row in select * from jsonb_to_recordset(p_rows) as r(student_id uuid, month text, raws jsonb, correction jsonb,
    payload jsonb, historical jsonb, unavailable text[], closed_at timestamptz, reconstructed boolean, computed_at timestamptz) loop
    insert into public.student_contribution_months as target(tenant_id, student_id, month, raws, correction, payload,
      historical, unavailable, closed_at, reconstructed, computed_at)
    values(p_tenant, row.student_id, row.month, row.raws, row.correction, coalesce(row.payload,'{}'), row.historical,
      coalesce(row.unavailable,'{}'), row.closed_at, coalesce(row.reconstructed,false), row.computed_at)
    on conflict (tenant_id, student_id, month) do update set raws = excluded.raws, correction = excluded.correction,
      payload = excluded.payload, historical = coalesce(target.historical, excluded.historical), unavailable = excluded.unavailable,
      closed_at = excluded.closed_at, reconstructed = excluded.reconstructed, computed_at = excluded.computed_at
    where target.closed_at is null and target.computed_at <= excluded.computed_at;
    get diagnostics changed = row_count;
    written := written + changed;
  end loop;
  return written;
end; $$;
create or replace function public.finish_student_contribution_refresh(p_tenant uuid, p_token uuid, p_success boolean) returns void
language sql security definer set search_path = public as $$
  update public.student_contribution_settings set refresh_token = null, refresh_started_at = null,
    history_ready = history_ready or p_success,
    refreshed_at = case when p_success then now() else refreshed_at end
  where tenant_id = p_tenant and refresh_token = p_token;
$$;
-- 학생당 한 줄의 가벼운 원래 수치. 점수는 현재 설정으로 앱이 계산한다.
create or replace function public.student_contribution_totals(p_tenant uuid, p_students uuid[], p_since text)
returns table(student_id uuid, raws jsonb, recent jsonb, computed_at timestamptz, unavailable text[])
language sql stable security definer set search_path = public as $$
  with months as (
    select * from public.student_contribution_months where tenant_id = p_tenant and student_id = any(p_students)
  ), values_by_metric as (
    select m.student_id, part.key, sum(part.value::numeric) as total,
      sum(case when m.month >= p_since then part.value::numeric else 0 end) as recent
    from months m cross join lateral (
      select * from jsonb_each_text(m.raws) union all select * from jsonb_each_text(m.correction)
    ) part group by m.student_id, part.key
  ), totals as (
    select v.student_id, jsonb_object_agg(v.key,v.total) raws, jsonb_object_agg(v.key,v.recent) recent
    from values_by_metric v group by v.student_id
  ) select t.student_id, t.raws, t.recent,
    (select max(m.computed_at) from months m where m.student_id = t.student_id),
    coalesce((select m.unavailable from months m where m.student_id = t.student_id order by m.month desc limit 1),'{}')
    from totals t order by t.student_id;
$$;
revoke all on function public.claim_student_contribution_refresh(uuid), public.save_student_contribution_months(uuid,uuid,bigint,jsonb),
  public.finish_student_contribution_refresh(uuid,uuid,boolean), public.student_contribution_totals(uuid,uuid[],text) from public, anon, authenticated;
grant execute on function public.claim_student_contribution_refresh(uuid), public.save_student_contribution_months(uuid,uuid,bigint,jsonb),
  public.finish_student_contribution_refresh(uuid,uuid,boolean), public.student_contribution_totals(uuid,uuid[],text) to service_role;
commit;
