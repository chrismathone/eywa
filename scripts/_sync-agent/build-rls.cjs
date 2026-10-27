// Reads schema metadata only. Generated policy applies exclusively to the new NOLOGIN role.
const fs = require('node:fs');
const metadata = JSON.parse(fs.readFileSync('scripts/_sync-agent/fixtures/database-shape.json','utf8'));
const tables = [...new Set(metadata.columns.map(c=>c.table_name))].sort();
if (tables.some(n=>!/^[a-z_]+$/.test(n))) throw new Error('Unexpected identifier');
const header = `-- No existing user policy is changed. New role has no login and is used only inside gateway transactions.
do $$ begin
  if not exists(select from pg_roles where rolname='eywa_sync_agent') then create role eywa_sync_agent nologin noinherit; end if;
  execute format('grant eywa_sync_agent to %I',current_user);
end $$;
grant usage on schema public to eywa_sync_agent;

-- Check tenant-bearing FK targets as well as the row itself. A device cannot attach
-- its own row to a student, teacher, invoice or class belonging to another tenant.
create function public.sync_agent_foreign_keys(p_table regclass,p_row jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare fk record; pair record; pred text; target_tenant text; permitted boolean;
begin
  for fk in select oid,confrelid,conkey,confkey from pg_constraint where conrelid=p_table and contype='f' loop
    select case when fk.confrelid='public.tenants'::regclass then 'id' else 'tenant_id' end into target_tenant;
    if not exists(select from pg_attribute where attrelid=fk.confrelid and attname=target_tenant and not attisdropped) then continue; end if;
    pred:='';
    for pair in
      select a.attname src,b.attname dst from unnest(fk.conkey,fk.confkey) k(src,dst)
      join pg_attribute a on a.attrelid=p_table and a.attnum=k.src
      join pg_attribute b on b.attrelid=fk.confrelid and b.attnum=k.dst
    loop
      if p_row->>pair.src is null then pred:=null; exit; end if;
      pred:=pred || format(' and to_jsonb(t)->>%L = $1->>%L',pair.dst,pair.src);
    end loop;
    if pred is null then continue; end if;
    execute format('select exists(select from %s t where t.%I = nullif(current_setting(''eywa.agent_tenant'',true),'''')::uuid %s)',fk.confrelid::regclass,target_tenant,pred)
      into permitted using p_row;
    if not permitted then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function public.sync_agent_foreign_keys(regclass,jsonb) from public,anon,authenticated;
grant execute on function public.sync_agent_foreign_keys(regclass,jsonb) to eywa_sync_agent;
`;
const policies = tables.map(n=>{
 const col=n==='tenants'?'id':'tenant_id';
 const where=`${col}=nullif(current_setting('eywa.agent_tenant',true),'')::uuid`;
 return `alter table public.${n} enable row level security;
grant select,insert,update,delete on public.${n} to eywa_sync_agent;
create policy sync_agent_allow on public.${n} for all to eywa_sync_agent using (${where}) with check (${where});
create policy sync_agent_tenant_boundary on public.${n} as restrictive for all to eywa_sync_agent
  using (${where}) with check (${where} and public.sync_agent_foreign_keys('public.${n}'::regclass,to_jsonb(${n})));`;
}).join('\n\n');
// 2026-10-27 시즌2: 0401a는 시즌1 합본(s1_season1.sql)의 구역이 됐다 — 다시 만들 일이 있으면 시즌2 파일(s2_NNNN_…)로 쓴다.
// ⚠️ 만들어지는 SQL은 `create function`·`create policy`(or replace·drop 없음)라 0401a가 적용된 DB에는 그대로 못 돌린다 — 손으로 멱등하게 고쳐 쓴다.
const out=process.argv[2];
if(!out||!/^supabase\/migrations\/s2_\d{4}_[a-z0-9_]+\.sql$/.test(out))throw new Error('출력 경로를 시즌2 이름으로 주세요: node scripts/_sync-agent/build-rls.cjs supabase/migrations/s2_NNNN_sync_agent_data_boundary.sql');
fs.writeFileSync(out,header+'\n'+policies+'\n');
console.log(`Generated restrictive policies for ${tables.length} tables.`);
