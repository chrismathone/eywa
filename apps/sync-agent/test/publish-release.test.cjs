const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const crypto=require('node:crypto');
const {main}=require('../publish-release.cjs');
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-release-publish-'));assert.ok(root.startsWith(path.resolve(os.tmpdir())+path.sep));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const appRoot=path.join(root,'apps/sync-agent'),directory=path.join(appRoot,'dist/release/2');fs.mkdirSync(directory,{recursive:true});
  const installer=Buffer.from('fixture installer'),zip=Buffer.from('fixture archive');
  const base='https://fixture.supabase.co/storage/v1/object/public/sync-agent-releases/2/';
  const manifest={protocol:1,sequence:2,version:'1.0.1',expiresAt:'2099-01-01',url:base+'AywaSync-1.0.1.zip',size:zip.length,sha256:sha(zip),files:[{path:'AywaSyncRuntime.exe',size:1,sha256:'a'.repeat(64)},{path:'resources/app.asar',size:1,sha256:'b'.repeat(64)}]};
  const payload=Buffer.from(JSON.stringify(manifest));
  const envelope={payload:payload.toString('base64'),signature:crypto.sign('RSA-SHA256',payload,pair.privateKey).toString('base64')};
  const checks={version:'1.0.1',sequence:2,installerUrl:base+'AywaSync-Setup-1.0.1.exe',installerSha256:sha(installer),archiveSha256:sha(zip)};
  fs.writeFileSync(path.join(appRoot,'build-config.json'),JSON.stringify({version:'1.0.1',sequence:2,publicKey:pair.publicKey.export({type:'spki',format:'pem'})}));
  for(const [name,bytes] of Object.entries({'AywaSync-Setup-1.0.1.exe':installer,'AywaSync-1.0.1.zip':zip,'release.json':JSON.stringify(envelope),'checksums.json':JSON.stringify(checks)}))fs.writeFileSync(path.join(directory,name),bytes);
  const state={published:new Map(),uploads:new Map(),calls:[],created:0,fail:false,loseResponse:false,evilLocation:false,bucketExists:false,bucketError:null,omitJsonLength:false};
  const bucket={id:'sync-agent-releases',public:true,file_size_limit:600*1024*1024};
  const sdk=()=>({storage:{listBuckets:async()=>({data:state.bucketExists?[bucket]:[]}),getBucket:async()=>({data:bucket}),createBucket:async(id,options)=>{state.created++;assert.equal(id,bucket.id);assert.equal(options.public,true);if(state.bucketError)return{error:{message:state.bucketError}};state.bucketExists=true;return{data:bucket};}}});
  const fetchImpl=async(value,options={})=>{
    const url=new URL(value),method=options.method??'GET';state.calls.push({url:url.href,method,options});assert.equal(options.redirect,'error');
    if(url.hostname==='fixture.supabase.co'){
      assert.equal(options.headers?.authorization,undefined);const bytes=state.published.get(path.basename(url.pathname));
      return bytes?new Response(method==='HEAD'?null:bytes,{status:200,headers:state.omitJsonLength&&url.pathname.endsWith('.json')?{}:{'content-length':String(bytes.length)}}):new Response(null,{status:404});
    }
    assert.equal(url.hostname,'fixture.storage.supabase.co');assert.equal(options.headers.authorization,'Bearer fixture-key');assert.equal(options.headers['Tus-Resumable'],'1.0.0');
    if(method==='POST'){
      const metadata=Object.fromEntries(options.headers['Upload-Metadata'].split(',').map(v=>{const [k,b]=v.split(' ');return[k,Buffer.from(b,'base64').toString()];}));
      assert.equal(metadata.bucketName,bucket.id);const id=String(state.uploads.size+1);state.uploads.set(id,{name:path.basename(metadata.objectName),size:Number(options.headers['Upload-Length']),bytes:Buffer.alloc(0)});
      return new Response(null,{status:201,headers:{location:state.evilLocation?'https://outside.example/upload':`https://fixture.storage.supabase.co/storage/v1/upload/resumable/${id}`}});
    }
    const row=state.uploads.get(path.basename(url.pathname));assert.ok(row);
    if(method==='HEAD')return new Response(null,{status:200,headers:{'upload-offset':String(row.bytes.length)}});
    assert.equal(method,'PATCH');assert.equal(Number(options.headers['Upload-Offset']),row.bytes.length);
    if(state.fail)throw Error('fixture interruption');row.bytes=Buffer.concat([row.bytes,options.body]);assert.ok(row.bytes.length<=row.size);
    if(row.bytes.length===row.size)state.published.set(row.name,row.bytes);
    if(state.loseResponse){state.loseResponse=false;throw Error('fixture response lost');}
    return new Response(null,{status:204,headers:{'upload-offset':String(row.bytes.length)}});
  };
  const run=argv=>main({argv:argv??['--apply'],appRoot,env:{NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'},sdk,fetchImpl,pause:async()=>{}});
  return{run,state,directory,installer,checks};
}
test('plan verifies artifacts without creating a bucket or uploading',async t=>{const f=fixture(t);await f.run([]);assert.equal(f.state.created,0);assert.equal(f.state.calls.length,0);});
test('signed artifacts publish to the matching project without overwriting existing files',async t=>{const f=fixture(t);await f.run();assert.equal(f.state.created,1);assert.equal(f.state.published.size,4);assert.deepEqual(f.state.published.get('AywaSync-Setup-1.0.1.exe'),f.installer);await f.run();assert.equal(f.state.calls.filter(c=>c.method==='POST').length,4);});
test('file limit failure does not create any upload or register a release',async t=>{const f=fixture(t);f.state.bucketError='The object exceeded the maximum allowed size';await assert.rejects(f.run(),/bucket creation failed/);assert.equal(f.state.calls.length,0);});
test('local installer tampering fails before storage access',async t=>{const f=fixture(t);fs.writeFileSync(path.join(f.directory,'AywaSync-Setup-1.0.1.exe'),'tampered');await assert.rejects(f.run(),/Local release changed/);assert.equal(f.state.created,0);assert.equal(f.state.calls.length,0);});
test('other-project release URL fails before storage writes',async t=>{const f=fixture(t);fs.writeFileSync(path.join(f.directory,'checksums.json'),JSON.stringify({...f.checks,installerUrl:'https://outside.example/app.exe'}));await assert.rejects(f.run(),/different storage project/);assert.equal(f.state.created,0);});
test('upload location cannot carry storage credentials to another host',async t=>{const f=fixture(t);f.state.evilLocation=true;await assert.rejects(f.run(),/Unexpected upload host/);assert.equal(f.state.calls.length,2);assert.equal(f.state.calls.some(c=>c.url.includes('outside.example')),false);});
test('a lost chunk response resumes from the server offset',async t=>{const f=fixture(t);f.state.loseResponse=true;await f.run();assert.equal(f.state.published.size,4);assert.equal(f.state.calls.filter(c=>c.method==='PATCH').length,4);});
test('interrupted upload resumes its existing session on the next invocation',async t=>{const f=fixture(t);f.state.fail=true;await assert.rejects(f.run(),/fixture interruption/);f.state.fail=false;await f.run();assert.equal(f.state.published.size,4);assert.equal(f.state.calls.filter(c=>c.method==='POST').length,4);});
test('different bytes already published at an immutable path are rejected',async t=>{const f=fixture(t);f.state.published.set('AywaSync-Setup-1.0.1.exe',Buffer.from('different'));await assert.rejects(f.run(),/never overwrite/);assert.equal(f.state.calls.filter(c=>c.method==='POST').length,0);});
test('JSON without Content-Length is verified by its decoded response bytes',async t=>{const f=fixture(t);f.state.omitJsonLength=true;await f.run();assert.equal(f.state.published.size,4);assert.equal(f.state.calls.filter(c=>c.method==='GET'&&c.url.endsWith('.json')).length,2);});
