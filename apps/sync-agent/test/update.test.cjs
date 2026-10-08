const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
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
