const {test}=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const {DeviceLease}=require('../lib/lease.cjs');const {verifyManifest,safeRelative}=require('../lib/update.cjs');
const {createBroker}=require('../lib/broker.cjs');const remoteDb=require('../../../scripts/_sync-agent/remote-db.cjs');
test('monotonic lease cannot be revived by delayed renewal',async()=>{
  let now=0,resolve;const api={call:async action=>action==='acquire'?{generation:'1',remainingMs:90000}:new Promise(r=>resolve=r)};let lost=0;
  const lease=new DeviceLease(api,{instanceId:crypto.randomUUID(),version:'1.0.0',now:()=>now,onLost:()=>lost++});assert.equal(await lease.acquire(),true);
  const renewal=lease.renew({});now=80001;resolve({remainingMs:90000,config:{}});assert.equal(await renewal,null);assert.equal(lease.held,false);assert.equal(lost,1);assert.equal(await lease.acquire(),false);
});
test('parallel claims issue one server request; no deadline extension on claim retry',async()=>{
  let calls=0,resolve,now=0;const lease=new DeviceLease({call:()=>{calls++;return new Promise(r=>resolve=r);}},{instanceId:crypto.randomUUID(),version:'1.0.0',now:()=>now});
  const first=lease.acquire();assert.equal(await lease.acquire(),false);resolve({generation:'9',remainingMs:90000});assert.equal(await first,true);now=50000;assert.equal(await lease.acquire(),true);assert.equal(lease.deadline,80000);assert.equal(calls,1);
});
test('network renewal failure retires execution immediately',async()=>{
  let lost=0;const lease=new DeviceLease({call:async a=>{if(a==='acquire')return{generation:'1',remainingMs:90000};throw new Error('offline');}},{instanceId:crypto.randomUUID(),version:'1.0.0',onLost:()=>lost++});
  await lease.acquire();await assert.rejects(lease.renew({}));assert.equal(lost,1);assert.throws(()=>lease.envelope('classnote'));
});
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const manifest={protocol:1,sequence:2,version:'1.1.0',expiresAt:'2099-01-01T00:00:00Z',url:'https://example.test/update.zip',sha256:'a'.repeat(64),size:5,files:[{path:'AywaSyncRuntime.exe',size:2,sha256:'b'.repeat(64)},{path:'resources/app.asar',size:3,sha256:'c'.repeat(64)}]};
const sign=m=>{const bytes=Buffer.from(JSON.stringify(m));return{payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')};};
test('release requires signed, compatible, increasing manifest',()=>{
  const e=sign(manifest);assert.equal(verifyManifest(e,pair.publicKey,{sequence:1}).sequence,2);
  assert.throws(()=>verifyManifest({...e,payload:Buffer.from(JSON.stringify({...manifest,sequence:100})).toString('base64')},pair.publicKey));
  for(const change of [{sequence:1},{protocol:2},{expiresAt:'2000-01-01'},{url:'http://example.test/a'},{size:3*1024**3},{files:[]}])assert.throws(()=>verifyManifest(sign({...manifest,...change}),pair.publicKey,{sequence:1}));
});
test('release accepts the full bundled runtime inventory and bounds oversized metadata',()=>{
  const files=[...manifest.files,...Array.from({length:10000},(_,i)=>({path:`resources/runtime/node_modules/library-${i}/dist/implementation.js`,size:1,sha256:'a'.repeat(64)}))];
  const envelope=sign({...manifest,files});assert.ok(envelope.payload.length>2*1024*1024);
  assert.equal(verifyManifest(envelope,pair.publicKey,{sequence:1}).files.length,10002);
  assert.throws(()=>verifyManifest({payload:'a'.repeat(4*1024*1024+1),signature:''},pair.publicKey),/invalid_manifest/);
});
test('Windows traversal, ADS, devices and case collisions are rejected',()=>{
  for(const name of ['../x','/x','x\\y','C:/x','x:ads','x/../y','x/CON.txt','x/NUL','x./a','a//b','x\u0000'])assert.throws(()=>safeRelative(name),name);
  assert.throws(()=>verifyManifest(sign({...manifest,files:[...manifest.files,{...manifest.files[0],path:'aywasyncruntime.exe'}]}),pair.publicKey));
});
test('remote DB is lazy, caches one execution, and transports fragments without SQL',async()=>{
  const calls=[];const sql=remoteDb('',{},async(action,body)=>{calls.push({action,body});return{rows:[{at:'2026-10-08T00:00:00Z'}],columns:[{name:'at',type:1184}],count:1};});
  const fragment=sql`where x=${1}`;const q=sql`select at ${fragment}`;assert.equal(calls.length,0);
  const row=await q;await q;assert.equal(calls.length,1);assert.ok(row[0].at instanceof Date);assert.equal(row.count,1);
  const transported=JSON.parse(JSON.stringify(calls[0].body));assert.equal(transported.parameters[0].kind,'fragment');assert.ok(!JSON.stringify(transported).includes('select at'));
  assert.throws(()=>sql.unsafe('delete from users'));await assert.rejects(sql.begin(async()=>{}));
});
test('loopback broker rejects unauthenticated, cross-origin and retired requests',async()=>{
  let held=true;const lease={generation:'1',deadline:80000,now:()=>0,assert(){if(!held)throw new Error('lost');},envelope(module){this.assert();return{instanceId:'fixture',generation:'1',module};}};
  const received=[];const b=await createBroker({module:'classnote',lease,api:{call:async(a,x)=>{received.push(x);return{ok:true};}},isDraining:()=>true,onCycle:()=>{},onEvent:()=>{}});
  try{
    const url=`http://127.0.0.1:${b.port}`;const request=(action,headers={},body={})=>fetch(url+action,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await request('/query')).status,401);assert.equal((await request('/query',{authorization:`Bearer ${b.token}`,origin:'https://evil.test'})).status,401);
    const headers={authorization:`Bearer ${b.token}`};assert.equal((await (await request('/state',headers)).json()).drain,true);
    await request('/query',headers,{module:'makeedu',instanceId:'attacker',generation:'999'});assert.deepEqual(received[0],{module:'classnote',instanceId:'fixture',generation:'1'});
    held=false;assert.equal((await request('/query',headers)).status,503);assert.equal(received.length,1);
  }finally{b.close();}
});
