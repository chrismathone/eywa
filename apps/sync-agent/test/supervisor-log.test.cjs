const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises'),{Supervisor}=require('../lib/supervisor.cjs'),{kstStamp}=require('../lib/worker-log.cjs');
test('native supervised worker streams dated local logs and only fixed summaries to the web',{timeout:15000},async()=>{
 const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/supervisor-log-')),resources=path.join(root,'resources'),entry=path.join(resources,'runtime/scripts/_makeedu/watch-sync-requests.cjs');
 fs.mkdirSync(path.dirname(entry),{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../build/WorkerHost.exe'),path.join(resources,'WorkerHost.exe'));
 fs.writeFileSync(entry,`console.log('──── students: import-students-list.cjs --apply');console.log('학생 이름과 상담 본문 fixture-private-password');(async()=>{for(;;){const r=await fetch('http://127.0.0.1:'+process.env.SYNC_AGENT_BROKER_PORT+'/state',{method:'POST',headers:{authorization:'Bearer '+process.env.SYNC_AGENT_BROKER_TOKEN,'content-type':'application/json',connection:'close'},body:'{}'});if((await r.json()).drain)return;await new Promise(r=>setTimeout(r,50));}})().catch(()=>process.exit(1));`);
 const tenantId=crypto.randomUUID(),instanceId=crypto.randomUUID(),events=[],api={call:async action=>{assert.ok(['module-start','module-stop'].includes(action));return{ok:true};}};
 const lease={held:true,generation:'1',instanceId,deadline:performance.now()+80000,now:()=>performance.now(),assert(){},envelope:module=>({module,generation:'1',instanceId}),lose(){throw Error('Unexpected lease loss');}};
 const supervisor=new Supervisor({resources,root,api,identity:{tenantId,deviceId:crypto.randomUUID(),secret:'fixture-device-secret'},lease,event:(kind,module,level,detail)=>events.push({kind,module,level,detail}),base:'https://fixture.invalid'});
 try {
  await supervisor.start('makeedu',{MAKEEDU_ID:'fixture-account',MAKEEDU_PW:'fixture-private-password'});
  const log=path.join(root,'tenants',tenantId,'log',kstStamp(Date.now()).slice(0,10),'makeedu.log');
  for(let i=0;i<100&&(!fs.existsSync(log)||!fs.readFileSync(log,'utf8').includes('상담 본문'));i++)await delay(50);
  const text=fs.readFileSync(log,'utf8');assert.ok(text.includes('+09:00'));assert.ok(text.includes('상담 본문'));assert.ok(!text.includes('fixture-private-password'));
  assert.equal(supervisor.busy,true);assert.ok(events.some(e=>e.kind==='worker_log'&&e.detail.logCode==='makeedu_students'));assert.ok(!JSON.stringify(events).includes('상담 본문'));
  supervisor.drain();for(let i=0;i<100&&supervisor.busy;i++)await delay(50);assert.equal(supervisor.busy,false);
 }finally{supervisor.kill();}
});
