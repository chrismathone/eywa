// Electron's fs treats *.asar paths as archives, so writing a release's resources/app.asar failed with
// "Invalid package" (every PC update ended in extract_failed until 1.0.5). Use the unpatched module there.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform,Readable}=require('node:stream');
const yauzl=require('yauzl');
const {atomicWrite}=require('./storage.cjs');
const {stageDelta}=require('./update-delta.cjs');
const MAX_SIZE=2*1024*1024*1024;
// 이 프로세스에서 지금 쓰고 있는 임시 폴더 — 다른 Updater(연결 해제 뒤 새로 만든 것 등)의 정리 루프가 지우지 않게.
const activeStages=new Set();
async function assertComplete(stage,m){for(const f of m.files){const st=await fsp.lstat(path.join(stage,...f.path.split('/'))).catch(()=>null);if(!st?.isFile()||st.size!==f.size)throw new Error('missing_files');}}
function safeRelative(name){
  if(typeof name!=='string'||name.length>230||/[\\:\x00-\x1f]/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('invalid_path');
  return name;
}
function verifyManifest(envelope,publicKey,{sequence=0,now=Date.now(),allowExisting=false}={}){
  if(!envelope||typeof envelope.payload!=='string'||envelope.payload.length>4*1024*1024||typeof envelope.signature!=='string')throw new Error('invalid_manifest');
  const bytes=Buffer.from(envelope.payload,'base64');
  if(!crypto.verify('RSA-SHA256',bytes,publicKey,Buffer.from(envelope.signature,'base64')))throw new Error('invalid_signature');
  const m=JSON.parse(bytes.toString('utf8'));
  if(allowExisting&&Number.isSafeInteger(m.sequence)&&m.sequence>0&&m.sequence<=sequence)return null;
  if(m.protocol!==1||!Number.isSafeInteger(m.sequence)||m.sequence<=sequence||!/^\d+\.\d+\.\d+$/.test(m.version)||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=now)throw new Error('incompatible_manifest');
  const url=new URL(m.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('invalid_url');
  if(!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.size)||m.size<=0||m.size>MAX_SIZE||!Array.isArray(m.files)||!m.files.length||m.files.length>20000)throw new Error('invalid_manifest');
  const names=new Set();let size=0;
  for(const f of m.files){safeRelative(f.path);const name=f.path.toLowerCase();if(names.has(name)||!Number.isSafeInteger(f.size)||f.size<0||f.size>MAX_SIZE||!/^[a-f0-9]{64}$/.test(f.sha256))throw new Error('invalid_file');names.add(name);size+=f.size;}
  if(size>6*1024*1024*1024||!names.has('aywasyncruntime.exe')||!names.has('resources/app.asar'))throw new Error('invalid_files');
  return m;
}
async function download(m,file,fetchImpl=fetch,{onProgress=()=>{},idleTimeoutMs=90_000}={}){
  // A stalled response used to show "downloading" for the entire 20-minute deadline.
  const stalled=new AbortController();let timer;
  const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>stalled.abort(new Error('download_stalled')),idleTimeoutMs);};
  const signal=AbortSignal.any([AbortSignal.timeout(20*60*1000),stalled.signal]);
  touch();onProgress({phase:'downloading',completed:0,total:m.size});
  try{
  const response=await fetchImpl(m.url,{redirect:'error',signal});
  if(!response.ok||!response.body)throw new Error('download_failed');
  const hash=crypto.createHash('sha256');let size=0;
  const meter=new Transform({transform(chunk,_enc,cb){size+=chunk.length;if(size>m.size)return cb(new Error('oversize'));touch();hash.update(chunk);onProgress({phase:'downloading',completed:size,total:m.size});cb(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(file,{flags:'wx'}),{signal});
  onProgress({phase:'verifying',completed:size,total:m.size});
  if(size!==m.size||hash.digest('hex')!==m.sha256)throw new Error('hash_mismatch');
  }catch(error){if(signal.aborted)throw new Error('download_timeout');throw error;}
  finally{clearTimeout(timer);}
}
async function extractVerified(file,target,m,{onProgress=()=>{}}={}){
  // Target is a newly created directory; never follow pre-existing directories or symlinks.
  await fsp.mkdir(target,{recursive:false});const expected=new Map(m.files.map(f=>[f.path.toLowerCase(),f]));const seen=new Set();let completed=0,bytes=0;const totalBytes=m.files.reduce((n,f)=>n+f.size,0);
  // 진행률은 용량으로도 낸다(원장 2026-11-06 — 큰 파일이 앞에 몰려 있어 파일 수로 세면 '67 / 10,021개 파일 · 0%'가 용량으로는 약 23%였다).
  onProgress({phase:'extracting',completed,total:expected.size,bytes,totalBytes});
  const zip=await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,decodeStrings:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z)));
  await new Promise((resolve,reject)=>{
    let failed=false;const fail=e=>{if(!failed){failed=true;zip.close();reject(e);}};
    zip.on('error',fail);zip.on('end',()=>{if(seen.size!==expected.size)fail(new Error('missing_files'));else resolve();});
    zip.on('entry',entry=>{(async()=>{
      const name=entry.fileName;
      if(name.endsWith('/')){safeRelative(name.slice(0,-1));zip.readEntry();return;}
      safeRelative(name);const kind=(entry.externalFileAttributes>>>16)&0xf000;
      if(kind&&kind!==0x8000)throw new Error('non_regular_file');
      const f=expected.get(name.toLowerCase());if(!f||f.path!==name||seen.has(name.toLowerCase())||entry.uncompressedSize!==f.size)throw new Error('unexpected_file');
      seen.add(name.toLowerCase());const dest=path.join(target,...name.split('/'));await fsp.mkdir(path.dirname(dest),{recursive:true});
      const input=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));const hash=crypto.createHash('sha256');let count=0;
      await pipeline(input,new Transform({transform(c,_e,cb){count+=c.length;if(count>f.size)return cb(new Error('oversize'));hash.update(c);cb(null,c);}}),fs.createWriteStream(dest,{flags:'wx'}));
      if(count!==f.size||hash.digest('hex')!==f.sha256)throw new Error('file_hash_mismatch');bytes+=f.size;onProgress({phase:'extracting',completed:++completed,total:expected.size,bytes,totalBytes});zip.readEntry();
    })().catch(fail);});zip.readEntry();
  });
}
class Updater {
  // currentRoot = 지금 도는 버전의 파일 폴더(패키지 실행 때만) — 있으면 바뀐 파일만 받는다(1.0.7).
  constructor({root,api,publicKey,sequence,event,fetchImpl=fetch,currentRoot=null}){Object.assign(this,{root,api,publicKey,sequence,event,fetchImpl,currentRoot});this.delta=null;this.state='idle';this.ready=null;this.pending=false;this.nextCheck=0;this.progress=null;this.failure=null;this.checkedAt=null;}
  async check(){
    if(this.pending||Date.now()<this.nextCheck)return;
    this.pending=true;this.nextCheck=Date.now()+6*3600000;this.failure=null;
    const progress=value=>{this.progress={...this.progress,...value,updatedAt:new Date().toISOString()};};
    this.progress=null;progress({phase:'checking',completed:0,total:0});
    let stage,archive,version;
    try {
      const {release}=await this.api.call('latest');this.checkedAt=new Date().toISOString();if(!release){this.state=this.ready?'ready':'idle';this.progress=null;return;}
      const m=verifyManifest(release,this.publicKey,{sequence:this.sequence,allowExisting:true});
      if(!m){this.state='idle';this.progress=null;return;}
      version=m.version;progress({version});
      if(this.ready?.sequence===m.sequence){this.state='ready';this.progress=null;return;}
      // A newer release needs its own decision; never keep applying the old
      // selection while its replacement is being downloaded.
      this.ready=null;
      let journal={};try{journal=JSON.parse(fs.readFileSync(path.join(this.root,'launch.json'),'utf8'));}catch{}
      if((journal.failed??[]).includes(m.sequence))throw new Error('release_quarantined');
      const versions=path.resolve(this.root,'versions');await fsp.mkdir(versions,{recursive:true});
      const destination=path.join(versions,String(m.sequence));
      if(fs.existsSync(destination)){
        const saved=JSON.parse(await fsp.readFile(path.join(destination,'release.json'),'utf8'));
        if(saved.payload!==release.payload||saved.signature!==release.signature)throw new Error('version_conflict');
        this.ready={sequence:m.sequence,version:m.version,expiresAt:m.expiresAt};this.state='ready';this.progress=null;return;
      }
      const keep=new Set([this.sequence,m.sequence,journal.current,journal.previous].map(String));
      for(const name of await fsp.readdir(versions)){
        // 지난 시도가 남긴 임시 폴더·zip(끊긴 PC 등) — 이 이름은 이 코드만 만든다.
        if(/^\d+\.stage-[0-9a-f-]{36}(?:\.zip)?$/.test(name)){if(!activeStages.has(path.join(versions,name.replace(/\.zip$/,''))))await fsp.rm(path.join(versions,name),{recursive:true,force:true}).catch(()=>{});continue;}
        if(!/^[1-9]\d*$/.test(name)||keep.has(name))continue;
        const old=path.resolve(versions,name);if(path.dirname(old)!==versions||(await fsp.lstat(old)).isSymbolicLink())continue;
        try{const oldEnvelope=JSON.parse(await fsp.readFile(path.join(old,'release.json'),'utf8'));const prior=verifyManifest(oldEnvelope,this.publicKey,{now:0});if(String(prior.sequence)!==name)continue;}catch{continue;}
        await fsp.rm(old,{recursive:true,force:true});
      }
      this.event('update_available','update','info',{version:m.version});this.state='downloading';
      stage=path.join(versions,`${m.sequence}.stage-${crypto.randomUUID()}`);archive=stage+'.zip';activeStages.add(stage);
      const filesBytes=m.files.reduce((n,f)=>n+f.size,0),freeBytes=async()=>{const free=await fsp.statfs(versions);return Number(free.bavail)*Number(free.bsize);};
      // 바뀐 파일만 — 지금 버전에서 같은 파일은 복사하고 나머지만 게시된 zip에서 범위 요청으로. 어긋나면 이 폴더를 지우고 전체 받기로.
      let staged=false;this.delta=null;
      if(this.currentRoot&&await freeBytes()>=filesBytes+256*1024*1024){
        try{this.delta=await stageDelta(m,this.currentRoot,stage,this.fetchImpl,{onProgress:progress,safeRelative});staged=true;}
        catch(error){
          if(error.code==='ENOSPC')throw error;this.delta={fallback:String(error.message??'').slice(0,40)};
          // 전체 받기는 새 폴더로(지우다 실패해도 섞이지 않게) · 진행률도 처음부터(바뀐 파일 수가 남지 않게).
          await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});activeStages.delete(stage);stage=path.join(versions,`${m.sequence}.stage-${crypto.randomUUID()}`);archive=stage+'.zip';activeStages.add(stage);
          this.progress={version,updatedAt:new Date().toISOString()};
        }
      }
      if(!staged){
        if(await freeBytes()<m.size+filesBytes+256*1024*1024)throw new Error('disk_full');
        await download(m,archive,this.fetchImpl,{onProgress:progress});await extractVerified(archive,stage,m,{onProgress:progress});
      }
      progress({phase:'finalizing',completed:m.files.length,total:m.files.length,files:0});await assertComplete(stage,m);atomicWrite(path.join(stage,'release.json'),JSON.stringify(release));
      if(fs.existsSync(destination))throw new Error('version_exists');await fsp.rename(stage,destination);await fsp.unlink(archive).catch(()=>{});
      this.ready={sequence:m.sequence,version:m.version,expiresAt:m.expiresAt};this.state='ready';this.progress=null;this.event('update_downloaded','update','info',{version:m.version});
    }catch(error){
      // Only this attempt's generated stage paths are removable; installed/active versions never match.
      const versions=path.resolve(this.root,'versions');
      for(const item of [archive,stage])if(item&&path.dirname(path.resolve(item))===versions&&/^\d+\.stage-[0-9a-f-]{36}(?:\.zip)?$/.test(path.basename(item)))await fsp.rm(item,{recursive:true,force:true}).catch(()=>{});
      const phase=this.progress?.phase;
      const code=error.message==='release_quarantined'?'release_quarantined':error.message==='download_timeout'?'download_timeout':
        error.message==='disk_full'||error.code==='ENOSPC'?'disk_full':['EACCES','EPERM','EBUSY'].includes(error.code)?'files_locked':
        ['hash_mismatch','file_hash_mismatch','oversize','unexpected_file','missing_files','non_regular_file','invalid_path'].includes(error.message)?'archive_invalid':
        phase==='checking'?'manifest_failed':phase==='downloading'?'download_failed':phase==='extracting'?'extract_failed':'prepare_failed';
      this.failure=code;this.progress=null;this.state='error';this.nextCheck=Date.now()+30*60000;this.event('update_failed','update','warning',{updateError:code,...(version?{version}:{})});
    }
    finally{this.pending=false;if(stage)activeStages.delete(stage);}
  }
  activate(){
    if(!this.ready)throw new Error('not_ready');const file=path.join(this.root,'launch.json');let prior={};try{prior=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
    const envelope=JSON.parse(fs.readFileSync(path.join(this.root,'versions',String(this.ready.sequence),'release.json'),'utf8'));
    const manifest=verifyManifest(envelope,this.publicKey,{sequence:this.sequence});
    if(manifest.sequence!==this.ready.sequence||manifest.version!==this.ready.version||(prior.failed??[]).includes(manifest.sequence))throw new Error('release_unavailable');
    atomicWrite(file,JSON.stringify({current:this.ready.sequence,previous:this.sequence,trial:true,failed:prior.failed??[]}));this.state='applying';
  }
}
module.exports={Updater,verifyManifest,safeRelative,extractVerified,download};
