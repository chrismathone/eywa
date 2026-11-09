const {test}=require('node:test');const assert=require('node:assert/strict');const fs=process.versions.electron?require('original-fs'):require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {extractVerified,download,Updater}=require('../lib/update.cjs');const {zipBytes}=require('./zip-fixture.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const base=path.resolve(__dirname,'../../../work');
const entries=[{name:'AywaSyncRuntime.exe',data:'fixture-exe'},{name:'resources/app.asar',data:'fixture-app'}];
const manifest=()=>({protocol:1,version:'1.1.0',sequence:2,expiresAt:'2099-01-01T00:00:00Z',url:'https://fixture.invalid/update.zip',size:zipBytes(entries).length,sha256:sha(zipBytes(entries)),files:entries.map(e=>({path:e.name,size:Buffer.byteLength(e.data),sha256:sha(e.data)}))});
test('verified ZIP preserves files and rejects corruption, traversal, symlinks, duplicate and missing entries',async()=>{
  for(const [name,list,ok]of [['valid',entries,true],['corrupt',[{...entries[0],data:'tampered!!!'},entries[1]],false],['traversal',[...entries,{name:'../escape',data:'x'}],false],['symlink',[{...entries[0],mode:0xa1ff},entries[1]],false],['duplicate',[...entries,entries[0]],false],['missing',[entries[0]],false]]){
    const root=fs.mkdtempSync(path.join(base,'zip-test-')),archive=path.join(root,'fixture.zip'),out=path.join(root,'extract');fs.writeFileSync(archive,zipBytes(list));
    if(ok){await extractVerified(archive,out,manifest());assert.equal(fs.readFileSync(path.join(out,'resources/app.asar'),'utf8'),'fixture-app');}
    else await assert.rejects(extractVerified(archive,out,manifest()),undefined,name);
    assert.equal(fs.existsSync(path.join(root,'escape')),false);
  }
});
test('download enforces exact length, hash and redirect refusal',async()=>{
  const bytes=zipBytes(entries),m=manifest(),root=fs.mkdtempSync(path.join(base,'download-test-'));let options;
  await download(m,path.join(root,'ok.zip'),async(_url,init)=>{options=init;return new Response(bytes);});assert.equal(options.redirect,'error');
  await assert.rejects(download({...m,size:bytes.length-1},path.join(root,'large.zip'),async()=>new Response(bytes)));
  await assert.rejects(download({...m,sha256:'a'.repeat(64)},path.join(root,'bad.zip'),async()=>new Response(bytes)));
});
test('updater recovers a fully staged release after restart and refuses quarantined or current versions',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),m=manifest(),payload=Buffer.from(JSON.stringify(m));const envelope={payload:payload.toString('base64'),signature:crypto.sign('RSA-SHA256',payload,pair.privateKey).toString('base64')};
  const root=fs.mkdtempSync(path.join(base,'updater-test-')),directory=path.join(root,'versions','2');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'release.json'),JSON.stringify(envelope));
  const create=sequence=>new Updater({root,api:{call:async()=>({release:envelope})},publicKey:pair.publicKey,sequence,event:()=>{}});
  const recovered=create(1);await recovered.check();assert.equal(recovered.state,'ready');recovered.activate();const journal=JSON.parse(fs.readFileSync(path.join(root,'launch.json'),'utf8'));assert.deepEqual(journal,{current:2,previous:1,trial:true,failed:[]});
  const current=create(2);await current.check();assert.equal(current.ready,null);assert.equal(current.state,'idle');
  fs.writeFileSync(path.join(root,'launch.json'),JSON.stringify({failed:[2]}));const quarantined=create(1);await quarantined.check();assert.equal(quarantined.ready,null);
});
test('a downloaded release still checks for newer versions and rechecks the signature at application',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),root=fs.mkdtempSync(path.join(base,'updater-new-release-'));
  const sign=m=>{const bytes=Buffer.from(JSON.stringify(m));return{payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')};};
  const releases=[sign(manifest()),sign({...manifest(),sequence:3,version:'1.2.0'})];
  for(let i=0;i<releases.length;i++){const dir=path.join(root,'versions',String(i+2));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify(releases[i]));}
  let calls=0;const updater=new Updater({root,api:{call:async()=>({release:releases[Math.min(calls++,1)]})},publicKey:pair.publicKey,sequence:1,event:()=>{}});
  await updater.check();assert.equal(updater.ready.sequence,2);updater.nextCheck=0;await updater.check();assert.equal(updater.ready.sequence,3);assert.equal(calls,2);
  fs.writeFileSync(path.join(root,'versions/3/release.json'),JSON.stringify({...releases[1],signature:'invalid'}));assert.throws(()=>updater.activate(),/invalid_signature/);assert.equal(fs.existsSync(path.join(root,'launch.json')),false);
});
test('download reports received bytes, separates verification and aborts a stalled body',async()=>{
  const bytes=zipBytes(entries),root=fs.mkdtempSync(path.join(base,'download-progress-')),progress=[];
  const body=new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,10));setTimeout(()=>{controller.enqueue(bytes.subarray(10));controller.close();},10);}});
  await download(manifest(),path.join(root,'ok.zip'),async()=>new Response(body),{onProgress:p=>progress.push(p)});
  assert.equal(progress[0].completed,0);assert.ok(progress.some(p=>p.phase==='downloading'&&p.completed===10));assert.equal(progress.at(-1).phase,'verifying');assert.equal(progress.at(-1).completed,bytes.length);
  let cancelled=false;
  await assert.rejects(download(manifest(),path.join(root,'stall.zip'),async()=>new Response(new ReadableStream({cancel(){cancelled=true;}})),{idleTimeoutMs:20}),/download_timeout/);
  assert.equal(cancelled,true);
});
test('updater exposes extraction progress and only marks fully verified files ready',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),m=manifest(),bytes=Buffer.from(JSON.stringify(m)),envelope={payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')};
  const root=fs.mkdtempSync(path.join(base,'updater-progress-')),events=[],progress=[];
  const updater=new Updater({root,api:{call:async()=>({release:envelope})},publicKey:pair.publicKey,sequence:1,event:(...e)=>events.push(e),fetchImpl:async()=>new Response(zipBytes(entries))});
  let value;Object.defineProperty(updater,'progress',{get(){return value;},set(p){value=p;if(p){assert.equal(this.ready,null);progress.push(p);}}});
  await updater.check();assert.equal(updater.state,'ready');assert.equal(updater.ready.sequence,2);assert.equal(updater.pending,false);assert.equal(updater.progress,null);assert.equal(updater.failure,null);
  assert.deepEqual([...new Set(progress.map(p=>p.phase))],['checking','downloading','verifying','extracting','finalizing']);
  assert.equal(progress.filter(p=>p.phase==='extracting').at(-1).completed,m.files.length);
  assert.equal(progress.filter(p=>p.phase==='extracting').at(-1).bytes,m.files.reduce((n,f)=>n+f.size,0)); // 용량 진행률(2026-11-06)
  assert.equal(events.at(-1)[0],'update_downloaded');assert.equal(fs.readdirSync(path.join(root,'versions')).some(n=>n.includes('.stage-')),false);
});
test('failure records a fixed reason, cleans only its staging files and permits manual retry',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),m=manifest(),bytes=Buffer.from(JSON.stringify(m)),envelope={payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')};
  const root=fs.mkdtempSync(path.join(base,'updater-failed-')),events=[];fs.mkdirSync(path.join(root,'versions/1'),{recursive:true});fs.writeFileSync(path.join(root,'versions/1/keep.txt'),'active');let fail=true,calls=0;
  const updater=new Updater({root,api:{call:async()=>{calls++;return{release:envelope};}},publicKey:pair.publicKey,sequence:1,event:(...e)=>events.push(e),fetchImpl:async()=>{if(fail)throw Error('private-path-or-token');return new Response(zipBytes(entries));}});
  await updater.check();assert.equal(updater.state,'error');assert.equal(updater.failure,'download_failed');assert.equal(updater.ready,null);assert.equal(updater.progress,null);assert.equal(updater.pending,false);
  assert.deepEqual(events.at(-1).at(-1),{updateError:'download_failed',version:m.version});assert.equal(JSON.stringify(events).includes('private-path-or-token'),false);assert.deepEqual(fs.readdirSync(path.join(root,'versions')),['1']);
  await updater.check();assert.equal(calls,1);fail=false;updater.nextCheck=0;await updater.check();assert.equal(calls,2);assert.equal(updater.state,'ready');assert.equal(updater.failure,null);assert.equal(fs.readFileSync(path.join(root,'versions/1/keep.txt'),'utf8'),'active');
});
test('a newer download removes a superseded version folder with its app.asar and stages the new one',async()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),root=fs.mkdtempSync(path.join(base,'updater-cleanup-'));
  const sign=m=>{const bytes=Buffer.from(JSON.stringify(m));return{payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')};};
  const old=path.join(root,'versions','2'),oldApp=path.join(root,'old-app');fs.mkdirSync(path.join(old,'resources'),{recursive:true});fs.mkdirSync(oldApp);fs.writeFileSync(path.join(oldApp,'main.js'),'old');
  fs.writeFileSync(path.join(old,'release.json'),JSON.stringify(sign(manifest())));await require('@electron/asar').createPackage(oldApp,path.join(old,'resources/app.asar'));
  const updater=new Updater({root,api:{call:async()=>({release:sign({...manifest(),sequence:4,version:'1.3.0'})})},publicKey:pair.publicKey,sequence:3,event:()=>{},fetchImpl:async()=>new Response(zipBytes(entries))});
  await updater.check();assert.equal(updater.failure,null);assert.equal(updater.state,'ready');assert.equal(updater.ready.sequence,4);
  assert.deepEqual(fs.readdirSync(path.join(root,'versions')),['4']);assert.equal(fs.readFileSync(path.join(root,'versions/4/resources/app.asar'),'utf8'),'fixture-app');
});
