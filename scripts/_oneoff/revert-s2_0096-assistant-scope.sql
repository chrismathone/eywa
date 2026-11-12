-- revert-s2_0096-assistant-scope.sql — s2_0096(학원 비서 권한 범위)을 되돌린다 · 2026-11-12
-- 증표·보기·발급 함수를 s2_0067 때로(지점만 묶는 증표 · 모든 보기 = 지점 조건만). 대응표(scope_tables·scope_columns)와 표지 칸(scope_keys)은 남긴다
-- (자료 없음 · 다시 적용하면 그대로 쓴다). 🔴 되돌리면 비서는 다시 그 지점 자료 전부를 읽는다 — 앱의 원장만 잠금을 먼저 되살린 뒤에 돌릴 것.
-- 순서: 옛 함수 정의(운영 덤프 그대로) → 보기 다시 만들기(옛 refresh_views) → 새 함수 지우기.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '180s';

CREATE OR REPLACE FUNCTION assistant_private.bound_tenant()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE PARALLEL RESTRICTED SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token text := current_setting('assistant.binding', true);
  v_parts text[];
begin
  if v_token is null or v_token = '' then return null; end if;
  v_parts := string_to_array(v_token, '.');
  if coalesce(array_length(v_parts, 1), 0) <> 3
     or v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or v_parts[2] !~ '^[0-9]{1,12}$'
     or v_parts[3] !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  if v_parts[2]::bigint < extract(epoch from now())::bigint then return null; end if;
  if encode(extensions.hmac(convert_to(v_parts[1] || '.' || v_parts[2], 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex') <> v_parts[3] then
    return null;
  end if;
  return v_parts[1]::uuid;
end $function$;

CREATE OR REPLACE FUNCTION public.assistant_issue_binding(p_tenant uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payload text;
begin
  if p_tenant is null or not exists (select 1 from public.tenants t where t.id = p_tenant) then
    raise exception 'assistant binding: 없는 지점' using errcode = '22023';
  end if;
  v_payload := p_tenant::text || '.' || extract(epoch from now() + interval '5 minutes')::bigint::text;
  return v_payload || '.' || encode(extensions.hmac(convert_to(v_payload, 'UTF8'), (select k.key from assistant_private.signing_key k where k.id), 'sha256'), 'hex');
end $function$;

CREATE OR REPLACE FUNCTION assistant_private.schema_signature()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select md5(
    coalesce((select string_agg(c.relname || '.' || a.attname || ':' || a.atttypid::text, ',' order by c.relname, a.attnum)
                from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                join pg_attribute a on a.attrelid = c.oid
               where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped), '')
    || '|' || coalesce((select string_agg(table_name, ',' order by table_name) from assistant_private.excluded_tables), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from assistant_private.hidden_columns), '')
    || '|' || coalesce((select string_agg(table_name || '.' || column_name || '=' || expr, ',' order by table_name, column_name) from assistant_private.masked_columns), '')
    || '|rules-v2'
  )
$function$;

CREATE OR REPLACE FUNCTION assistant_private.refresh_views()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '3s'
AS $function$
declare
  r record;
  v_cols text;
  v_n integer := 0;
  v_sig text := assistant_private.schema_signature();
begin
  perform pg_advisory_xact_lock(hashtext('assistant_private.refresh_views'));
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'assistant' and c.relkind = 'v' loop
    execute format('drop view if exists assistant.%I cascade', r.relname);
  end loop;

  for r in
    select c.oid, c.relname,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as has_tenant
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
       and not exists (select 1 from assistant_private.excluded_tables x where x.table_name = c.relname)
     order by c.relname
  loop
    -- 🔴 coalesce(format(...))로 쓰지 말 것 — format은 NULL을 빈 글자로 바꿔 '() as 칸'이 된다(로컬 시험에서 잡음).
    select string_agg(case when m.expr is not null then format('(%s) as %I', m.expr, a.attname) else format('t.%I', a.attname) end, ', ' order by a.attnum)
      into v_cols
      from pg_attribute a
      left join assistant_private.masked_columns m on m.table_name = r.relname and m.column_name = a.attname
     where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
       and not assistant_private.secret_column(a.attname)
       and not exists (select 1 from assistant_private.hidden_columns h where h.table_name = r.relname and h.column_name = a.attname);
    continue when v_cols is null;

    if r.has_tenant then
      execute format('create view assistant.%I with (security_barrier = true) as select %s from public.%I t where t.tenant_id = (select assistant_private.bound_tenant())',
                     r.relname, v_cols, r.relname);
    elsif r.relname = 'tenants' then
      execute format('create view assistant.tenants with (security_barrier = true) as select %s from public.tenants t where t.id = (select assistant_private.bound_tenant())', v_cols);
    elsif r.relname = 'consultation_ai_analysis' then
      execute format('create view assistant.consultation_ai_analysis with (security_barrier = true) as select %s from public.consultation_ai_analysis t
                       where exists (select 1 from public.enrollment_consultations p where p.id = t.consultation_id and p.tenant_id = (select assistant_private.bound_tenant()))', v_cols);
    elsif r.relname = 'notice_popup_translations' then
      execute format('create view assistant.notice_popup_translations with (security_barrier = true) as select %s from public.notice_popup_translations t
                       where exists (select 1 from public.notice_popups p where p.id = t.notice_id and p.tenant_id = (select assistant_private.bound_tenant()))', v_cols);
    else
      continue; -- 지점 칸도 지점 부모도 없는 표 = 학원 자료가 아니다(슈퍼관리자 · 연동 PC 배포 · 이관 표시 · 공용 설정)
    end if;
    v_n := v_n + 1;
  end loop;

  perform assistant_private.create_ontology_views();

  execute 'revoke all on all tables in schema assistant from public, anon, authenticated, service_role';
  execute 'grant select on all tables in schema assistant to aywa_assistant';

  insert into assistant_private.state (id, signature, refreshed_at, views) values (true, v_sig, now(), v_n)
  on conflict (id) do update set signature = excluded.signature, refreshed_at = excluded.refreshed_at, views = excluded.views;
  return jsonb_build_object('views', v_n, 'signature', v_sig);
end $function$;

select assistant_private.refresh_views();

drop function if exists public.assistant_issue_scoped_binding(uuid, uuid, text[]);
drop function if exists public.assistant_scope_map();
drop function if exists assistant_private.bound_tenant(text);
drop function if exists assistant_private.binding_claims();

revoke all on all functions in schema assistant_private from public, anon, authenticated, service_role, aywa_assistant;
grant execute on function assistant_private.bound_tenant() to aywa_assistant;
revoke all on function public.assistant_issue_binding(uuid) from public, anon, authenticated, aywa_assistant;
grant execute on function public.assistant_issue_binding(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
