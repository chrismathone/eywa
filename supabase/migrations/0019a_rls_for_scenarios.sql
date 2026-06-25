-- RLS for scenarios
-- ⚠️ scenarios 테이블은 이후 0020_lonely_chat 에서 제거됨(기능 폐기). 신규 DB 프로비저닝(db:alphas)은
-- 이 파일을 0020 적용 이후에 실행하므로 테이블이 없다 → 존재할 때만 RLS 적용하도록 가드(없으면 no-op).
-- (운영적합성 감사 B4: alpha 일괄 적용이 깨끗이 수렴하도록.)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'scenarios'
  ) then
    execute 'alter table public.scenarios enable row level security';
    execute 'drop policy if exists scenarios_tenant_isolation on public.scenarios';
    execute $p$create policy scenarios_tenant_isolation on public.scenarios
      for all to authenticated
      using (tenant_id = public.auth_tenant_id())
      with check (tenant_id = public.auth_tenant_id())$p$;
  end if;
end $$;
