// Bundle the actual server services against the isolated fixture connection. Only authentication
// session lookup and tenant feature settings are supplied locally; all device/lease SQL is real.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
module.exports=async function apiChecks(sql,{tenant,other,student,check}){
  const root=path.resolve(__dirname,'../..'),out=path.join(root,'work/sync-agent-build/control-fixture.cjs');
  const esbuild=require('../../apps/sync-agent/node_modules/esbuild');
  await esbuild.build({stdin:{contents:['control','security','lifecycle','gateway','operations'].map(n=>`export * from ${JSON.stringify(path.join(root,'src/features/sync-agent/server',n+'.ts'))};`).join('\n'),resolveDir:root,loader:'ts'},outfile:out,bundle:true,platform:'node',format:'cjs',external:['postgres'],plugins:[{name:'fixture-boundaries',setup(build){
    build.onResolve({filter:/^(server-only|@\/lib\/auth\/(current-user|perm-matrix)|@\/features\/owner\/server\/queries)$/},args=>({path:args.path,namespace:'fixture'}));
    build.onResolve({filter:/^\.\/db$/},args=>args.importer.includes('sync-agent')?{path:'fixture-db',namespace:'fixture'}:null);
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='fixture-db'?'export const agentDb=()=>global.__agentFixtureSql;':args.path.includes('current-user')?'export const getCurrentUser=async()=>global.__agentFixtureUser;':args.path.includes('perm-matrix')?'export const canWriteTenant=async()=>true;':args.path.includes('queries')?'export const getTenantSettingsByTenantId=async()=>({modules:{disabled:[]}});':'export {};'}));
  }}]});
  global.__agentFixtureSql=sql;global.__agentFixtureUser={id:crypto.randomUUID(),tenantId:tenant,displayName:'Fixture',systemRole:'admin'};
  process.env.SYNC_AGENT_CODE_SECRET='isolated-fixture-secret-not-a-production-value';
  const svc=require(out),deviceId=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url'),code='001122334455';
  await sql`insert into users(id,tenant_id) values(${global.__agentFixtureUser.id},${tenant})`;
  await sql`insert into sync_agent_codes(tenant_id,code_hash,issued_by,expires_at) values(${tenant},${svc.privateHash(`code:${code}`)},${global.__agentFixtureUser.id},now()+interval '10 minutes')`;
  const pair={code,deviceId,secret,name:'fixture PC'};
  let device,instanceId=crypto.randomUUID(),generation;
  await check('actual pair service consumes a leading-zero code exactly once',async()=>{
    const first=await svc.pairDevice(pair,'fixture');assert.equal(first.tenantId,tenant);const retry=await svc.pairDevice(pair,'fixture');assert.equal(retry.deviceId,deviceId);
    await assert.rejects(svc.pairDevice({...pair,deviceId:crypto.randomUUID()},'fixture'),e=>e.code==='invalid_code');
    await assert.rejects(svc.pairDevice({...pair,secret:crypto.randomBytes(32).toString('base64url')},'fixture'),e=>e.code==='invalid_code');
  });
  await check('actual authentication accepts only the bound device secret',async()=>{
    const request=token=>new Request('https://fixture.invalid',{headers:{authorization:'Bearer '+token}});
    device=await svc.authenticate(request(`${deviceId}.${secret}`));assert.equal(device.tenantId,tenant);
    await assert.rejects(svc.authenticate(request(`${deviceId}.${'x'.repeat(43)}`)),e=>e.code==='unauthorized');
  });
  await check('actual claim and heartbeat use the same instance/generation',async()=>{
    const row=await svc.acquireDevice(device,{instanceId,version:'1.0.0'});generation=row.generation;
    await assert.rejects(svc.acquireDevice(device,{instanceId:crypto.randomUUID(),version:'1.0.0'}),e=>e.code==='device_busy');
  });
  const envelope={instanceId,generation,module:'classnote'},status={state:'working',classnote:'running',makeedu:'off',update:'idle',busy:true};
  await check('cutover refuses a legacy heartbeat and starts only after it expires',async()=>{
    await sql`insert into classnote_workers(tenant_id,hostname,last_seen) values(${tenant},'legacy',now())`;
    await assert.rejects(svc.prepareCutover(device,{instanceId,generation}),e=>e.code==='legacy_busy');
    await sql`update classnote_workers set last_seen=now()-interval '181 seconds' where tenant_id=${tenant}`;
    assert.equal((await svc.prepareCutover(device,{instanceId,generation})).ready,true);await svc.moduleSession(device,envelope,false);
  });
  await check('actual gateway commits no-column heartbeat and finalization commands with empty arrays',async()=>{
    const worker={instanceId,generation,module:'makeedu'};
    await svc.moduleSession(device,worker,false);
    const catalog=require('../../src/features/sync-agent/server/query-catalog.json');
    const query=(text,parameters)=>svc.runAgentQuery(device,{...worker,id:Object.entries(catalog).find(([,v])=>v.parts.join('').includes(text))[0],parameters});
    await sql.unsafe('alter table makeedu_sync_workers add unique(tenant_id,hostname)');
    const beat=await query('insert into makeedu_sync_workers',[tenant,'managed-fixture',new Date().toISOString()]);
    assert.deepEqual(beat,{rows:[],columns:[],count:1});
    const runId=crypto.randomUUID();await sql`insert into makeedu_sync_runs(id,tenant_id,status) values(${runId},${tenant},'running')`;
    const done=await query('update makeedu_sync_runs',['ok',100,{kind:'json',value:{students:{status:'ok',rows:0}}},[],null,runId]);
    assert.deepEqual(done,{rows:[],columns:[],count:1});
    const [run]=await sql`select status,failed_domains,domains from makeedu_sync_runs where id=${runId}`;
    assert.equal(run.status,'ok');assert.deepEqual(run.failed_domains,[]);assert.deepEqual(run.domains,{students:{status:'ok',rows:0}});
    await svc.moduleSession(device,worker,true);
  });
  const requestId=crypto.randomUUID();
  await check('real feed-comments accepts only legacy routing helpers, strips them and prevents duplicate notifications',async()=>{
    await sql.unsafe('alter table notifications alter column id set default gen_random_uuid()');
    await sql.unsafe('alter table classnote_feed_state add unique(tenant_id,scope)');
    const plan={tenant_id:tenant,recipient_id:global.__agentFixtureUser.id,type:'classnote_parent_comment',title:'fixture',body:'fixture',link:'https://fixture.invalid/comment/1',dedupeKey:'comment:1',fromEvent:true};
    const input={readAt:null,counts:{'1':1},mark:null,plan:[plan]},operation=input=>svc.runAgentOperation(device,{...envelope,operation:'feed-comments',input});
    assert.equal((await operation(input)).raced,false);assert.equal((await operation(input)).raced,true);
    const rows=await sql`select type,title,body from notifications where tenant_id=${tenant}`;assert.equal(rows.length,1);assert.equal(rows[0].body,'fixture');
    await assert.rejects(operation({...input,plan:[{...plan,stdout:'private'}]}),e=>e.code==='invalid_input');
    const [state]=await sql`select updated_at,counts from classnote_feed_state where tenant_id=${tenant} and scope='parent_comments'`;
    await assert.rejects(operation({...input,readAt:state.updated_at.toISOString(),plan:[{...plan,tenant_id:other}]}),e=>e.code==='tenant_mismatch');
    const [after]=await sql`select counts from classnote_feed_state where tenant_id=${tenant} and scope='parent_comments'`;assert.deepEqual(after.counts,{'1':1});
  });
  await sql`insert into classnote_sync_requests(id,tenant_id,status,next_scope) values(${requestId},${tenant},'running',null)`;
  const finish=()=>svc.runAgentOperation(device,{...envelope,operation:'finish-class-sync',input:{id:requestId,status:'done',result:{ok:true},error:null}});
  await check('module OFF permits completion of already-running work but rejects a new start',async()=>{
    await sql`update sync_agent_settings set classnote_enabled=false where tenant_id=${tenant}`;
    await svc.heartbeatDevice(device,{instanceId,generation,version:'1.0.0',status});
    const [session]=await sql`select stop_after from sync_agent_module_sessions where device_id=${deviceId}`;assert.ok(session.stop_after);
    await assert.rejects(svc.moduleSession(device,envelope,false),e=>e.code==='module_disabled');
    assert.equal((await finish()).finished,true);
  });
  await check('drain deadline does not extend and stopping a module fences late requests',async()=>{
    const [before]=await sql`select stop_after from sync_agent_module_sessions where device_id=${deviceId}`;
    await svc.heartbeatDevice(device,{instanceId,generation,version:'1.0.0',status});const [after]=await sql`select stop_after from sync_agent_module_sessions where device_id=${deviceId}`;
    assert.equal(before.stop_after.toISOString(),after.stop_after.toISOString());await svc.moduleSession(device,envelope,true);await assert.rejects(finish(),e=>e.code==='lease_lost');
  });
  await check('scheduled sync and login claim the latest periods only once',async()=>{
    const e={instanceId,generation,module:'makeedu'};const jobs=[];for(let i=0;i<3;i++)jobs.push((await svc.scheduleDevice(device,e)).job);
    assert.equal(jobs.filter(Boolean).length,2);assert.deepEqual(jobs.filter(Boolean).map(j=>j.kind).sort(),['login','sync']);
    await svc.scheduleDevice(device,{...e,finish:{...jobs[0],ok:true}});const [row]=await sql`select succeeded from sync_agent_schedule_runs where tenant_id=${tenant} and kind=${jobs[0].kind}`;assert.equal(row.succeeded,true);
    await assert.rejects(svc.scheduleDevice(device,{...e,generation:'999'}),e=>e.code==='lease_lost');
  });
  await check('structured event log rejects raw personal data and deduplicates IDs',async()=>{
    const event={id:crypto.randomUUID(),at:new Date().toISOString(),kind:'job_succeeded',module:'classnote',level:'info',detail:{task:'queue',count:1}};
    await svc.storeDeviceEvents(device,{events:[event,event]});const [row]=await sql`select count(*) n from sync_agent_events where device_id=${deviceId}`;assert.equal(Number(row.n),1);
    await assert.rejects(svc.storeDeviceEvents(device,{events:[{...event,detail:{message:'raw fixture student'}}]}),e=>e.code==='invalid_input');
  });
  await check('request body reader enforces declared and streamed size limits',async()=>{
    const request=new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({oversize:'x'.repeat(100)})});
    await assert.rejects(svc.readBody(request,20),e=>e.code==='too_large');
  });
  delete global.__agentFixtureSql;delete global.__agentFixtureUser;delete process.env.SYNC_AGENT_CODE_SECRET;
};
