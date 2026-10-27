// Destructive fixture work is confined to a fresh database in a labeled loopback-only container.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');const postgres=require('postgres');
const { readMigration } = require('../../src/lib/db/migrations-corpus.mjs');
async function main(){
  const [container]=JSON.parse(execFileSync('docker',['inspect','eywa-worker-lease-test-20261008'],{encoding:'utf8',windowsHide:true}));
  assert.equal(container.Config.Labels['eywa.test'],'worker-lease');assert.equal(container.Config.Image,'postgres:17-alpine');
  const [port]=container.NetworkSettings.Ports['5432/tcp'];assert.equal(port.HostIp,'127.0.0.1');
  const options={host:'127.0.0.1',port:Number(port.HostPort),username:'postgres',password:'local-fixture-only',ssl:false,prepare:false,connect_timeout:10};
  const admin=postgres({...options,database:'postgres',max:1}),database='agent_test_'+crypto.randomUUID().replaceAll('-','');let sql;const checks=[];
  const check=async(name,fn)=>{console.error(name);await fn();checks.push(name);};
  try{
    await admin.unsafe(`create database "${database}"`);sql=postgres({...options,database,max:32});
    for(const role of ['anon','authenticated','service_role'])if(!(await admin`select 1 from pg_roles where rolname=${role}`).length)await admin.unsafe(`create role ${role}`);
    const shape=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../scripts/_sync-agent/fixtures/database-shape.json'),'utf8'));const tables=new Map();
    for(const c of shape.columns){if(!tables.has(c.table_name))tables.set(c.table_name,[]);tables.get(c.table_name).push(c);}
    for(const [table,columns]of tables){assert.match(table,/^[a-z_]+$/);const defs=columns.map(c=>{
      assert.match(c.column_name,/^[a-z0-9_]+$/);const type=c.data_type==='ARRAY'?'text[]':c.data_type==='USER-DEFINED'?'text':c.data_type;
      return `"${c.column_name}" ${type}${c.column_name==='id'?' primary key':''}`;
    });await sql.unsafe(`create table public."${table}" (${defs.join(',')})`);}
    await sql.unsafe('alter table enrollments add foreign key(student_id) references students(id)');
    await sql.unsafe('alter table enrollments add foreign key(class_id) references classes(id)');
    for(const name of ['0400a_sync_agent_control.sql','0401a_sync_agent_data_boundary.sql','0402a_sync_agent_management.sql','0403a_sync_agent_module_sessions.sql'])await sql.unsafe(readMigration(name));
    const a=crypto.randomUUID(),b=crypto.randomUUID(),studentA=crypto.randomUUID(),studentB=crypto.randomUUID(),classA=crypto.randomUUID(),classB=crypto.randomUUID();
    await sql`insert into tenants(id,name) values(${a},'fixture A'),(${b},'fixture B')`;
    await sql`insert into students(id,tenant_id,name) values(${studentA},${a},'A'),(${studentB},${b},'B')`;
    await sql`insert into classes(id,tenant_id) values(${classA},${a}),(${classB},${b})`;
    const scoped=(tenant,fn)=>sql.begin(async tx=>{if(tenant)await tx`select set_config('eywa.agent_tenant',${tenant},true)`;await tx`set local role eywa_sync_agent`;return fn(tx);});
    await check('existing PUBLIC policies need only bounded helper grants; tenant isolation remains enforced',async()=>{
      await sql.unsafe("create function public.auth_tenant_id() returns uuid language sql stable as 'select null::uuid'; create function public.auth_system_role() returns text language sql stable as 'select null::text'; revoke all on function public.auth_tenant_id(),public.auth_system_role() from public");
      await sql.unsafe('create policy fixture_existing_helper on students for select to public using(tenant_id=public.auth_tenant_id())');
      await assert.rejects(scoped(a,tx=>tx`select id from students`),{code:'42501'});
      await sql.unsafe(readMigration("0406a_sync_agent_policy_function_grants.sql"));
      assert.deepEqual((await scoped(a,tx=>tx`select id from students`)).map(r=>r.id),[studentA]);
      assert.equal((await scoped(null,tx=>tx`select id from students`)).length,0);
      const [role]=await sql`select rolinherit,rolbypassrls,rolsuper from pg_roles where rolname='eywa_sync_agent'`;
      assert.deepEqual(role,{rolinherit:false,rolbypassrls:false,rolsuper:false});
    });
    await check('missing tenant context reads no data',async()=>assert.equal((await scoped(null,tx=>tx`select id from students`)).length,0));
    await check('restrictive policy defeats existing broad public policy',async()=>{
      await sql.unsafe('create policy fixture_broad on students for all to public using(true) with check(true)');
      assert.deepEqual((await scoped(a,tx=>tx`select id from students`)).map(r=>r.id),[studentA]);
    });
    await check('cross-tenant insert and tenant reassignment are denied',async()=>{
      await assert.rejects(scoped(a,tx=>tx`insert into students(id,tenant_id,name) values(${crypto.randomUUID()},${b},'invalid')`),{code:'42501'});
      await assert.rejects(scoped(a,tx=>tx`update students set tenant_id=${b} where id=${studentA}`),{code:'42501'});
    });
    await check('cross-tenant student/class foreign keys are denied',async()=>{
      for(const [student,cls]of [[studentB,classA],[studentA,classB]])await assert.rejects(scoped(a,tx=>tx`insert into enrollments(id,tenant_id,student_id,class_id) values(${crypto.randomUUID()},${a},${student},${cls})`),{code:'42501'});
    });
    await check('same-tenant enrollment is accepted',async()=>assert.equal((await scoped(a,tx=>tx`insert into enrollments(id,tenant_id,student_id,class_id) values(${crypto.randomUUID()},${a},${studentA},${classA}) returning id`)).length,1));
    await check('other tenant delete affects no rows',async()=>assert.equal((await scoped(a,tx=>tx`delete from students where id=${studentB}`)).count,0));
    await check('device role cannot read codes or change controls',async()=>{
      await assert.rejects(scoped(a,tx=>tx`select * from sync_agent_codes`),{code:'42501'});await assert.rejects(scoped(a,tx=>tx`update sync_agent_settings set enabled=true`),{code:'42501'});
    });
    let device;
    await check('32 parallel registrations create only one active device',async()=>{
      const results=await Promise.all(Array.from({length:32},()=>sql`insert into sync_agent_devices(id,tenant_id,token_hash,name) values(${crypto.randomUUID()},${a},${'a'.repeat(64)},'fixture') on conflict do nothing returning id`));
      const winners=results.flat();assert.equal(winners.length,1);device=winners[0].id;
    });
    let owner,generation;
    await check('32 parallel runtime claims select only one generation',async()=>{
      const ids=Array.from({length:32},()=>crypto.randomUUID());const rows=await Promise.all(ids.map(id=>sql`select * from claim_sync_agent(${device},${id},'1.0.0')`));const winner=rows.findIndex(r=>r.length);assert.equal(rows.filter(r=>r.length).length,1);owner=ids[winner];generation=String(rows[winner][0].generation);
    });
    await check('lost response retry preserves the generation',async()=>assert.equal(String((await sql`select * from claim_sync_agent(${device},${owner},'1.0.0')`)[0].generation),generation));
    await check('revocation request blocks both current and new claims',async()=>{
      await sql`update sync_agent_devices set revoke_requested_at=now() where id=${device}`;
      for(const id of [owner,crypto.randomUUID()])assert.equal((await sql`select * from claim_sync_agent(${device},${id},'1.0.0')`).length,0);
      await sql`update sync_agent_devices set revoke_requested_at=null,lease_until=now()-interval '1 second' where id=${device}`;
    });
    await check('expiry takeover increases generation and fences the old instance',async()=>{
      const replacement=crypto.randomUUID();const [row]=await sql`select * from claim_sync_agent(${device},${replacement},'1.0.0')`;assert.equal(BigInt(row.generation),BigInt(generation)+1n);assert.equal((await sql`select * from claim_sync_agent(${device},${owner},'1.0.0')`).length,0);
    });
    for(const role of ['anon','authenticated'])await check(`${role} has no device registration or claim privilege`,async()=>{
      await assert.rejects(sql.begin(async tx=>{await tx.unsafe(`set local role ${role}`);return tx`select * from claim_sync_agent(${device},${owner},'1.0.0')`;}),{code:'42501'});
    });
    const c=crypto.randomUUID();await sql`insert into tenants(id,name) values(${c},'API fixture')`;
    await require('./control-api-fixture.cjs')(sql,{tenant:c,other:b,student:studentA,check});
    await check('unrelated tenant data is unchanged',async()=>assert.deepEqual(await sql`select name from students where id=${studentB}`.then(r=>[...r]),[{name:'B'}]));
    console.log(JSON.stringify({passed:checks.length,checks},null,2));
  }finally{if(sql)await sql.end({timeout:5});await admin.unsafe(`drop database if exists "${database}" with (force)`);await admin.end();}
}
main().catch(e=>{console.error(e.message,e.actual?.message,e.actual?.where);process.exitCode=1;});
