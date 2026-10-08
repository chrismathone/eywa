// Publish only the already signed, immutable artifacts. Registration is a separate step.
// Usage: node --env-file=../../.env.local publish-release.cjs [--apply]
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {createClient}=require('../../node_modules/@supabase/supabase-js');
const {verifyManifest}=require('./lib/update.cjs');
const bucket='sync-agent-releases',chunkSize=6*1024*1024;
async function hash(stream){const h=crypto.createHash('sha256');let size=0;for await(const c of stream){h.update(c);size+=c.length;}return{sha256:h.digest('hex'),size};}
async function main({argv=process.argv.slice(2),appRoot=__dirname,env=process.env,sdk=createClient,fetchImpl=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const options=new Set(argv);for(const o of options)assert.equal(o,'--apply','Unknown option');
  const build=JSON.parse(fs.readFileSync(path.join(appRoot,'build-config.json'))),directory=path.join(appRoot,'dist/release',String(build.sequence));
  const checks=JSON.parse(fs.readFileSync(path.join(directory,'checksums.json'))),envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json')));
  const manifest=verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});
  assert.equal(manifest.sequence,build.sequence);assert.equal(manifest.version,build.version);
  assert.equal(checks.version,build.version);assert.equal(checks.sequence,build.sequence);assert.equal(checks.archiveSha256,manifest.sha256);
  const app=new URL(env.NEXT_PUBLIC_SUPABASE_URL);assert.match(app.hostname,/^[a-z]+\.supabase\.co$/);
  assert.equal(app.protocol,'https:');assert.ok(!app.username&&!app.password&&!app.search&&!app.hash);assert.ok(env.SUPABASE_SERVICE_ROLE_KEY,'Storage credentials are required');
  const base=new URL(`/storage/v1/object/public/${bucket}/${build.sequence}/`,app);
  const files=[
    {name:`AywaSync-Setup-${build.version}.exe`,type:'application/octet-stream',expected:checks.installerSha256,url:checks.installerUrl},
    {name:`AywaSync-${build.version}.zip`,type:'application/zip',expected:manifest.sha256,url:manifest.url},
    {name:'release.json',type:'application/json'},
    {name:'checksums.json',type:'application/json'},
  ];
  for(const file of files){
    file.path=path.join(directory,file.name);Object.assign(file,{local:await hash(fs.createReadStream(file.path))});
    if(file.expected)assert.equal(file.local.sha256,file.expected,'Local release changed');
    const expectedUrl=new URL(file.name,base).href;if(file.url)assert.equal(file.url,expectedUrl,'Release belongs to a different storage project');file.url=expectedUrl;
    if(file.name.endsWith('.zip'))assert.equal(file.local.size,manifest.size);
  }
  const client=sdk(app.href,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const current=await client.storage.listBuckets();if(current.error)throw Error(`Storage lookup failed: ${current.error.message}`);
  let existing=current.data.find(b=>b.id===bucket);
  if(!options.has('--apply')){console.log(JSON.stringify({verified:true,uploaded:false,bucketExists:!!existing,sequence:build.sequence,version:build.version,files:files.map(f=>({name:f.name,...f.local}))}));return;}
  if(!existing){
    const created=await client.storage.createBucket(bucket,{public:true,fileSizeLimit:600*1024*1024,allowedMimeTypes:['application/octet-stream','application/zip','application/json']});
    if(created.error)throw Error(`Release bucket creation failed: ${created.error.message}`);
    existing=(await client.storage.getBucket(bucket)).data;
  }
  assert.ok(existing?.public,'Release bucket must support public downloads');
  assert.ok(!existing.file_size_limit||existing.file_size_limit>=Math.max(...files.map(f=>f.local.size)),'Release bucket file limit is too small');
  const storage=new URL(app.href);storage.hostname=app.hostname.replace('.supabase.co','.storage.supabase.co');
  const auth={authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,apikey:env.SUPABASE_SERVICE_ROLE_KEY,'Tus-Resumable':'1.0.0'};
  const stateDir=path.resolve(appRoot,'../../work/sync-agent-publish',String(build.sequence));fs.mkdirSync(stateDir,{recursive:true});
  const request=async(url,init)=>{const parsed=new URL(url);assert.equal(parsed.origin,storage.origin,'Upload redirected outside this project');return fetchImpl(parsed,{...init,redirect:'error',signal:AbortSignal.timeout(120000)});};
  for(const file of files){
    const remote=await fetchImpl(file.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(remote.status===200){
      const response=await fetchImpl(file.url,{redirect:'error',signal:AbortSignal.timeout(20*60*1000)});assert.equal(response.status,200);
      assert.deepEqual(await hash(response.body),file.local,'Existing public release differs; never overwrite it');
      console.log(JSON.stringify({file:file.name,alreadyPublished:true}));continue;
    }
    assert.ok([400,404].includes(remote.status),`Unexpected public file status: ${remote.status}`);
    const objectName=`${build.sequence}/${file.name}`,stateFile=path.join(stateDir,file.name+'.json');
    let uploadUrl;
    if(fs.existsSync(stateFile)){
      const saved=JSON.parse(fs.readFileSync(stateFile));assert.equal(saved.sha256,file.local.sha256,'Saved upload belongs to different bytes');uploadUrl=saved.url;
    }
    if(!uploadUrl){
      const metadata=Object.entries({bucketName:bucket,objectName,contentType:file.type,cacheControl:'31536000'}).map(([k,v])=>`${k} ${Buffer.from(v).toString('base64')}`).join(',');
      const created=await request(new URL('/storage/v1/upload/resumable',storage),{method:'POST',headers:{...auth,'Upload-Length':String(file.local.size),'Upload-Metadata':metadata,'Content-Length':'0'}});
      if(created.status!==201)throw Error(`Upload creation failed (${created.status}): ${(await created.text()).slice(0,300)}`);
      assert.ok(created.headers.get('location'),'Upload location is missing');uploadUrl=new URL(created.headers.get('location'),storage).href;
      assert.equal(new URL(uploadUrl).origin,storage.origin,'Unexpected upload host');
      fs.writeFileSync(stateFile,JSON.stringify({url:uploadUrl,sha256:file.local.sha256}));
    }
    const offset=async()=>{const r=await request(uploadUrl,{method:'HEAD',headers:auth});assert.equal(r.status,200,`Upload state failed: ${r.status}`);const header=r.headers.get('upload-offset');assert.ok(header&&/^\d+$/.test(header),'Upload offset is missing');const value=Number(header);assert.ok(Number.isSafeInteger(value)&&value>=0&&value<=file.local.size);return value;};
    let done=await offset(),reported=-1;const fd=fs.openSync(file.path,'r');
    try{while(done<file.local.size){
      const bytes=Buffer.alloc(Math.min(chunkSize,file.local.size-done));assert.equal(fs.readSync(fd,bytes,0,bytes.length,done),bytes.length);
      let success=false;
      for(let attempt=0;attempt<5&&!success;attempt++){
        try{const r=await request(uploadUrl,{method:'PATCH',headers:{...auth,'Upload-Offset':String(done),'Content-Type':'application/offset+octet-stream','Content-Length':String(bytes.length)},body:bytes});
          if(r.status===204){assert.equal(Number(r.headers.get('upload-offset')),done+bytes.length);done+=bytes.length;success=true;}
          else if(r.status===409||r.status>=500){const observed=await offset();if(observed===done+bytes.length){done=observed;success=true;}else assert.equal(observed,done);}
          else throw Error(`Upload rejected (${r.status}): ${(await r.text()).slice(0,300)}`);
        }catch(error){if(attempt===4)throw error;const observed=await offset();if(observed===done+bytes.length){done=observed;success=true;}else assert.equal(observed,done);}
        if(!success)await pause(3000);
      }
      assert.ok(success,'Upload retries exhausted');const progress=Math.floor(done/file.local.size*10)*10;if(progress!==reported){reported=progress;console.log(JSON.stringify({file:file.name,progress}));}
    }}finally{fs.closeSync(fd);}
    const published=await fetchImpl(file.url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(published.status,200,'Public download is unavailable');
    const length=published.headers.get('content-length');
    if(length!==null)assert.equal(Number(length),file.local.size,'Public download size differs');
    // JSON can be transferred compressed without Content-Length. Its actual bytes
    // still have to match; EXE/ZIP are fully rehashed by register-release.
    if(file.name.endsWith('.json')){
      const response=await fetchImpl(file.url,{redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
      assert.deepEqual(await hash(response.body),file.local,'Public release metadata differs');
    }
    console.log(JSON.stringify({file:file.name,uploaded:true,bytes:file.local.size}));
  }
  console.log(JSON.stringify({uploaded:true,registered:false,sequence:build.sequence,version:build.version,next:'Run register-release.cjs --verify-remote, then register the verified release.'}));
}
module.exports={main};
if(require.main===module)main().catch(error=>{let message=String(error.message);for(const value of [process.env.SUPABASE_SERVICE_ROLE_KEY,process.env.DATABASE_URL])if(value)message=message.replaceAll(value,'[redacted]');console.error(message);process.exitCode=1;});
