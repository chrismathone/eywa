// 바뀐 파일만 받는 업데이트(1.0.7) — 지금 버전에서 같은 파일은 복사, 나머지만 게시된 zip에서 범위 요청으로. 어긋나면 전체 받기.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {stageDelta,copyReusable,RangeReader}=require('../lib/update-delta.cjs');const {Updater}=require('../lib/update.cjs');const {noteTask,noteJob}=require('../lib/supervisor.cjs');
const {zipBytes}=require('./zip-fixture.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');const base=path.resolve(__dirname,'../../../work');
// 큰 파일(400KB)은 끝 부분 밖에 있어 실제 범위 요청으로 받아야 한다.
const big=Buffer.alloc(400*1024,7),entries=[{name:'AywaSyncRuntime.exe',data:'runtime-v2'},{name:'resources/app.asar',data:'app-v2-new'},{name:'resources/big.bin',data:big},{name:'resources/runtime/a.mjs',data:'export const a=1;'}];
const archive=zipBytes(entries);
const manifest=()=>({protocol:1,version:'1.0.7',sequence:9,expiresAt:'2099-01-01T00:00:00Z',url:'https://fixture.invalid/AywaSync-1.0.7.zip',size:archive.length,sha256:sha(archive),
  files:entries.map(e=>({path:e.name,size:Buffer.byteLength(e.data),sha256:sha(Buffer.from(e.data))}))});
// 지금 버전 폴더 — 바뀐 것: 실행 파일(같은 크기·다른 내용), app.asar(크기도 다름). 같은 것: big.bin, a.mjs.
function currentRoot(overrides={}){
  const root=fs.mkdtempSync(path.join(base,'delta-current-'));
  const files={'AywaSyncRuntime.exe':'runtime-v1','resources/app.asar':'app-v1','resources/big.bin':big,'resources/runtime/a.mjs':'export const a=1;',...overrides};
  for(const [name,data]of Object.entries(files)){if(data==null)continue;const p=path.join(root,...name.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);}
  return root;
}
// 범위 요청을 지키는 가짜 저장소 — 받은 범위를 남긴다. honor=false면 범위를 무시하고 전체를 200으로(지원 안 하는 서버).
function storage({honor=true,failAfter=Infinity}={}){
  const log=[];
  const fetchImpl=async(_url,init={})=>{
    const range=init.headers?.Range;log.push(range??'full');
    if(!range||!honor)return new Response(archive,{status:200});
    if(log.filter(r=>r!=='full').length>failAfter)return new Response('busy',{status:503}); // 끝 부분은 주고 항목 본문에서 실패
    const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(range),s=Number(a),e=Number(b);
    return new Response(archive.subarray(s,e+1),{status:206,headers:{'content-range':`bytes ${s}-${e}/${archive.length}`}});
  };
  return {log,fetchImpl};
}
const read=(root,name)=>fs.readFileSync(path.join(root,...name.split('/')));

test('같은 파일은 복사하고 바뀐 파일만 받는다 — 큰 같은 파일은 받지 않는다',async()=>{
  const root=currentRoot(),target=path.join(fs.mkdtempSync(path.join(base,'delta-stage-')),'stage'),{log,fetchImpl}=storage(),progress=[];
  const result=await stageDelta(manifest(),root,target,fetchImpl,{onProgress:p=>progress.push(p)});
  assert.deepEqual(result,{reused:2,fetched:2});
  for(const e of entries)assert.deepEqual(read(target,e.name),Buffer.from(e.data),e.name);
  assert.ok(log.every(r=>r!=='full'),'전체를 받지 않는다');
  // 받은 바이트 = 끝 부분 + 바뀐 두 항목 근처뿐(400KB짜리 big.bin은 안 받는다).
  const bytes=log.reduce((n,r)=>{const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(r);return n+Number(b)-Number(a)+1;},0);
  assert.ok(bytes<archive.length/2,`받은 바이트 ${bytes} / ${archive.length}`);
  assert.ok(progress.some(p=>p.phase==='copying')&&progress.some(p=>p.phase==='downloading'&&p.files===2));
  // 복사 진행률은 용량으로도 — 0에서 시작해 줄지 않고, 끝 값이 판 목록 전체 크기와 같다(원장 2026-11-06).
  const copying=progress.filter(p=>p.phase==='copying'),filesBytes=manifest().files.reduce((n,f)=>n+f.size,0);
  assert.equal(copying[0].bytes,0);assert.equal(copying.at(-1).bytes,filesBytes);assert.equal(copying.at(-1).totalBytes,filesBytes);assert.ok(copying.every((p,i)=>!i||p.bytes>=copying[i-1].bytes));
});

test('같은 크기라도 내용이 다르면(해시) 복사하지 않고 받는다',async()=>{
  const root=currentRoot({'resources/runtime/a.mjs':'export const b=1;'}),target=path.join(fs.mkdtempSync(path.join(base,'delta-stage-')),'stage');
  const result=await stageDelta(manifest(),root,target,storage().fetchImpl);
  assert.equal(result.fetched,3);assert.equal(read(target,'resources/runtime/a.mjs').toString(),'export const a=1;');
});

test('범위 요청을 지원하지 않거나 그대로 쓸 것이 적으면 던진다(부르는 쪽이 전체 받기로)',async()=>{
  const stage=()=>path.join(fs.mkdtempSync(path.join(base,'delta-stage-')),'stage');
  await assert.rejects(stageDelta(manifest(),currentRoot(),stage(),storage({honor:false}).fetchImpl),/range_unsupported/);
  const empty=fs.mkdtempSync(path.join(base,'delta-empty-'));const {log,fetchImpl}=storage();
  await assert.rejects(stageDelta(manifest(),empty,stage(),fetchImpl),/delta_not_worth/);assert.equal(log.length,0);
});

test('게시된 zip이 서명된 목록과 다르면(내용·누락) 받지 않는다',async()=>{
  const stage=()=>path.join(fs.mkdtempSync(path.join(base,'delta-stage-')),'stage');
  const tampered={...manifest(),files:manifest().files.map(f=>f.path==='resources/app.asar'?{...f,sha256:'a'.repeat(64)}:f)};
  await assert.rejects(stageDelta(tampered,currentRoot(),stage(),storage().fetchImpl),/file_hash_mismatch/);
  const missing={...manifest(),files:[...manifest().files,{path:'resources/extra.bin',size:3,sha256:sha(Buffer.from('abc'))}]};
  await assert.rejects(stageDelta(missing,currentRoot(),stage(),storage().fetchImpl),/missing_files/);
});

test('범위 응답의 위치·전체 크기가 다르면 거절한다',async()=>{
  const reader=new RangeReader('https://fixture.invalid/x.zip',archive.length,async()=>new Response('xx',{status:206,headers:{'content-range':`bytes 0-1/${archive.length+1}`}}),undefined,()=>{});
  await assert.rejects(reader.block(0,2),/range_unsupported/);
});

function signed(m){const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),bytes=Buffer.from(JSON.stringify(m));return{publicKey:pair.publicKey,envelope:{payload:bytes.toString('base64'),signature:crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64')}};}

test('업데이트 — 지금 버전 폴더가 있으면 바뀐 파일만, 범위 요청이 안 되면 전체 받기로 돌아가 같은 결과',async()=>{
  for(const honor of [true,false]){
    const {publicKey,envelope}=signed(manifest()),root=fs.mkdtempSync(path.join(base,'delta-updater-')),{log,fetchImpl}=storage({honor}),phases=new Set();
    const updater=new Updater({root,api:{call:async()=>({release:envelope})},publicKey,sequence:8,event:()=>{},fetchImpl,currentRoot:currentRoot()});
    let value;Object.defineProperty(updater,'progress',{get(){return value;},set(p){value=p;if(p?.phase)phases.add(p.phase);}});
    await updater.check();
    assert.equal(updater.state,'ready',`honor=${honor} failure=${updater.failure}`);assert.equal(updater.ready.sequence,9);
    for(const e of entries)assert.deepEqual(read(path.join(root,'versions','9'),e.name),Buffer.from(e.data));
    assert.deepEqual(fs.readdirSync(path.join(root,'versions')),['9'],'임시 폴더를 남기지 않는다');
    if(honor){assert.deepEqual(updater.delta,{reused:2,fetched:2});assert.ok(!log.includes('full'));assert.ok(!phases.has('extracting'));}
    else{assert.equal(updater.delta.fallback,'range_unsupported');assert.ok(phases.has('extracting'));}
  }
});

test('복사 작업자 하나가 실패하면 나머지도 멈추고, 다 멈춘 뒤에 던진다 — 지운 폴더를 다시 만들지 않는다',async()=>{
  const root=fs.mkdtempSync(path.join(base,'delta-fail-')),files=[{path:'a/b',data:'under'}];
  for(let i=0;i<300;i++)files.push({path:`many/f${i}.txt`,data:`v${i}`});
  for(const f of files){const p=path.join(root,...f.path.split('/'));fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,f.data);}
  const m={files:files.map(f=>({path:f.path,size:Buffer.byteLength(f.data),sha256:sha(Buffer.from(f.data))}))};
  const target=path.join(fs.mkdtempSync(path.join(base,'delta-fail-stage-')),'stage');
  // 새 폴더가 생긴 직후 'a'를 파일로 만들어 둔다 → 'a/b'를 복사하는 작업자가 폴더를 못 만들어 실패한다.
  const blocked=copyReusable(m,root,target,{concurrency:8,onProgress:p=>{if(p.completed===0)fs.writeFileSync(path.join(target,'a'),'blocker');}});
  await assert.rejects(blocked,e=>['EEXIST','ENOTDIR'].includes(e.code));
  const copied=fs.existsSync(path.join(target,'many'))?fs.readdirSync(path.join(target,'many')).length:0;
  assert.ok(copied<50,`실패 뒤에도 계속 복사했다: ${copied}개`);
  fs.rmSync(target,{recursive:true,force:true});await new Promise(r=>setTimeout(r,200));
  assert.equal(fs.existsSync(target),false,'지운 폴더가 다시 생기지 않는다');
});

test('전체 받기로 넘어가면 진행률을 처음부터 · 마무리는 파일 수 · 지난 시도의 임시 폴더는 치운다',async()=>{
  const {publicKey,envelope}=signed(manifest()),root=fs.mkdtempSync(path.join(base,'delta-progress-')),stale=path.join(root,'versions','9.stage-00000000-0000-0000-0000-000000000000');
  fs.mkdirSync(stale,{recursive:true});fs.writeFileSync(stale+'.zip','old');const seen=[];
  // 끝 부분(중앙 디렉터리)까지는 받고 바뀐 항목 본문에서 실패 → 바뀐 파일 수가 실린 진행률이 나온 뒤 전체 받기로.
  const updater=new Updater({root,api:{call:async()=>({release:envelope})},publicKey,sequence:8,event:()=>{},fetchImpl:storage({failAfter:1}).fetchImpl,currentRoot:currentRoot()});
  let value;Object.defineProperty(updater,'progress',{get(){return value;},set(p){value=p;if(p?.phase)seen.push({...p});}});
  await updater.check();assert.equal(updater.state,'ready');assert.ok(updater.delta.fallback);
  assert.ok(seen.some(p=>p.phase==='downloading'&&p.files===2),'바뀐 파일 받기 진행률이 먼저 나왔다');
  const after=seen.slice(seen.findIndex(p=>p.phase==='downloading'&&!p.files));
  assert.ok(after.length&&after.every(p=>!p.files),'전체 받기 진행률에 바뀐 파일 수가 남지 않는다');
  assert.deepEqual(seen.filter(p=>p.phase==='finalizing').map(p=>[p.completed,p.total]),[[entries.length,entries.length]]);
  assert.deepEqual(fs.readdirSync(path.join(root,'versions')),['9']);
});

test('지금 하는 일 — 단계 이름은 기록, 새 주기·쉬는 중은 비움, 예약 작업은 시작·끝 알림으로',()=>{
  const r={};
  noteTask(r,{phase:'stage',task:'queue'});assert.equal(r.task,'queue');const since=r.taskSince;
  noteTask(r,{phase:'stage'});assert.equal(r.task,'queue');assert.equal(r.taskSince,since);
  noteTask(r,{phase:'stage',task:'bad name!'});assert.equal(r.task,'queue');
  noteTask(r,{phase:'idle'});assert.equal(r.task,null);
  noteJob(r,{kind:'job_started',detail:{task:'sync'}});assert.equal(r.task,'sync');
  noteJob(r,{kind:'job_succeeded',detail:{task:'queue'}});assert.equal(r.task,'sync');
  noteJob(r,{kind:'job_failed',detail:{task:'sync'}});assert.equal(r.task,null);
});
