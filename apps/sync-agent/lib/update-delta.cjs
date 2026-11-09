// 바뀐 파일만 받는 업데이트(1.0.7 · 원장 2026-10-16 "이후에는 필요한것만").
// ① 지금 도는 버전 폴더(currentRoot)에서 경로·크기가 같은 파일을 복사하며 해시를 본다 — 서명된 목록의 sha256과 같으면 그대로 쓴다.
// ② 나머지(바뀐 파일)는 게시된 전체 zip에 범위 요청을 보내 그 항목만 받는다(끝 부분·중앙 디렉터리는 한 번에 받아 둔다).
// 모든 파일은 서명된 목록의 크기·sha256과 맞아야 쓴다. 어느 단계든 어긋나면 던진다 — 부르는 쪽이 이 폴더를 지우고 전체 받기로 돌아간다.
const fs=process.versions.electron?require('original-fs'):require('node:fs');
const fsp=fs.promises;
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform,Readable,PassThrough}=require('node:stream');
const yauzl=require('yauzl');
// EOCD_SCAN = yauzl이 끝에서 읽는 길이(디렉터리 끝 표시 + 설명 최대 + zip64 위치 표시 20바이트)와 같게 — 끝 부분을 한 번에 받아 둔다.
const BLOCK=64*1024,EOCD_SCAN=22+0xffff+20,KEEP_BLOCKS=12,MAX_DIRECTORY=64*1024*1024;
// 바뀐 파일이 이보다 많으면 범위 요청을 하나씩 보내기보다 전체를 한 번에 받는 편이 빠르다.
const MAX_FETCH_FILES=2000;
// 그대로 쓸 수 있어 보이는 크기가 이보다 적으면(대부분 바뀜) 처음부터 전체를 받는다 — 요청 수백 번보다 한 번에 받는 편이 빠르다.
const MIN_REUSE=0.3;

function hashing(f){
  let count=0;const hash=crypto.createHash('sha256');
  const t=new Transform({transform(c,_e,cb){count+=c.length;if(count>f.size)return cb(new Error('oversize'));hash.update(c);cb(null,c);}});
  t.matches=()=>count===f.size&&hash.digest('hex')===f.sha256;
  return t;
}
const sourceOf=(root,f)=>path.join(root,...f.path.split('/'));
async function sameSize(root,f){try{const st=await fsp.lstat(sourceOf(root,f));return st.isFile()&&st.size===f.size;}catch{return false;}}

/** ① — 새 폴더(target)를 만들고 그대로 쓸 수 있는 파일을 복사한다. 반환 = 받아야 할 파일(서명된 목록 항목). */
async function copyReusable(m,currentRoot,target,{onProgress=()=>{},concurrency=8}={}){
  const total=m.files.reduce((n,f)=>n+f.size,0);let candidate=0;
  for(const f of m.files)if(await sameSize(currentRoot,f))candidate+=f.size;
  if(candidate<total*MIN_REUSE)throw new Error('delta_not_worth');
  await fsp.mkdir(target,{recursive:false});
  const needed=[],queue=[...m.files];let completed=0,bytes=0,failure=null;
  // 진행률은 용량으로도 낸다(원장 2026-11-06 — 큰 파일이 앞에 몰려 있어 파일 수로 세면 '67 / 10,021개 파일 · 0%'가 용량으로는 약 23%였다). bytes = 처리를 마친 파일(복사했든 받을 목록으로 넘겼든)의 크기 합.
  const report=()=>onProgress({phase:'copying',completed,total:m.files.length,bytes,totalBytes:total});
  report();
  const one=async f=>{
    if(!(await sameSize(currentRoot,f))){needed.push(f);return;}
    const dest=sourceOf(target,f);await fsp.mkdir(path.dirname(dest),{recursive:true});const check=hashing(f);
    try{await pipeline(fs.createReadStream(sourceOf(currentRoot,f)),check,fs.createWriteStream(dest,{flags:'wx'}));}
    catch(error){await fsp.rm(dest,{force:true});if(error.code==='ENOSPC')throw error;needed.push(f);return;}
    if(!check.matches()){await fsp.rm(dest,{force:true});needed.push(f);}
  };
  // 한 작업자가 실패하면 나머지도 멈추고, 모두 끝난 뒤에 던진다 — 부르는 쪽이 폴더를 지우는 동안 다른 작업자가 다시 쓰지 않게.
  await Promise.allSettled(Array.from({length:concurrency},async()=>{
    for(let f;!failure&&(f=queue.shift());){try{await one(f);completed++;bytes+=f.size;report();}catch(error){failure??=error;return;}}
  }));
  if(failure)throw failure;
  if(completed!==m.files.length)throw new Error('copy_incomplete');
  if(needed.length>MAX_FETCH_FILES)throw new Error('delta_too_many');
  return needed;
}

/** 게시된 zip 하나를 범위 요청으로 읽는다. 작은 읽기(항목 머리)는 64KB 단위로 받아 두고, 끝 부분·중앙 디렉터리는 지우지 않는다. */
class RangeReader extends yauzl.RandomAccessReader {
  constructor(url,size,fetchImpl,signal,onBytes){super();Object.assign(this,{url,size,fetchImpl,signal,onBytes});this.blocks=[];}
  cached(start,end){for(const b of this.blocks)if(start>=b.start&&end<=b.start+b.data.length)return b.data.subarray(start-b.start,end-b.start);return null;}
  async fetchRange(start,end){
    const response=await this.fetchImpl(this.url,{headers:{Range:`bytes=${start}-${end-1}`},redirect:'error',signal:this.signal});
    const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
    if(response.status!==206||!range||Number(range[1])!==start||Number(range[2])!==end-1||Number(range[3])!==this.size){
      await response.body?.cancel().catch(()=>{});throw new Error('range_unsupported');
    }
    return response;
  }
  async block(start,end){
    const data=Buffer.from(await (await this.fetchRange(start,end)).arrayBuffer());
    if(data.length!==end-start)throw new Error('range_short');
    this.onBytes(data.length);this.blocks.push({start,data});if(this.blocks.length>KEEP_BLOCKS)this.blocks.splice(2,1);
    return data;
  }
  _readStreamForRange(start,end){
    const hit=this.cached(start,end);if(hit)return Readable.from([hit]);
    const out=new PassThrough();
    (async()=>{
      if(end-start<=BLOCK){const data=await this.block(start,Math.min(this.size,start+BLOCK));out.end(data.subarray(0,end-start));return;}
      const response=await this.fetchRange(start,end);
      await pipeline(Readable.fromWeb(response.body),new Transform({transform:(c,_e,cb)=>{this.onBytes(c.length);cb(null,c);}}),out);
    })().catch(error=>out.destroy(error));
    return out;
  }
}

/** ② — 받아야 할 파일만 게시된 zip에서 범위 요청으로 꺼내 target에 쓴다. 진행률 = 그 항목들의 압축 크기 합. */
async function fetchNeeded(m,needed,target,fetchImpl,{onProgress=()=>{},idleTimeoutMs=90_000,safeRelative}={}){
  if(!needed.length)return;
  const want=new Map(needed.map(f=>[f.path.toLowerCase(),f]));
  const stalled=new AbortController();let timer;
  const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>stalled.abort(new Error('download_stalled')),idleTimeoutMs);};
  const signal=AbortSignal.any([AbortSignal.timeout(20*60*1000),stalled.signal]);
  let received=0,total=0;
  const reader=new RangeReader(m.url,m.size,fetchImpl,signal,n=>{received+=n;touch();if(total)onProgress({phase:'downloading',completed:Math.min(received,total),total,files:needed.length});});
  touch();
  try{
    // 끝 부분(디렉터리 끝 표시) → 중앙 디렉터리 — 한 번씩만 받는다(항목 1만 개를 하나씩 읽으면 요청이 2만 번이다).
    const tailStart=Math.max(0,m.size-EOCD_SCAN),tail=await reader.block(tailStart,m.size);
    const at=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
    if(at<0||at+22>tail.length)throw new Error('zip_end_missing');
    const cdSize=tail.readUInt32LE(at+12),cdOffset=tail.readUInt32LE(at+16);
    if(cdOffset===0xffffffff||cdSize===0xffffffff||cdOffset+cdSize>tailStart+at)throw new Error('zip64_unsupported');
    if(m.size-cdOffset>MAX_DIRECTORY)throw new Error('directory_too_large'); // 조작된 끝 표시로 zip 전체를 메모리로 받지 않게
    if(cdOffset<tailStart)await reader.block(cdOffset,m.size); // 디렉터리가 끝 부분과 걸쳐도 한 덩어리로
    const zip=await new Promise((resolve,reject)=>yauzl.fromRandomAccessReader(reader,m.size,{lazyEntries:true,autoClose:false,decodeStrings:true,validateEntrySizes:true},(e,z)=>e?reject(e):resolve(z)));
    try{
      const entries=await new Promise((resolve,reject)=>{const found=[];zip.on('error',reject);zip.on('end',()=>resolve(found));
        zip.on('entry',entry=>{if(!entry.fileName.endsWith('/')&&want.has(entry.fileName.toLowerCase()))found.push(entry);zip.readEntry();});zip.readEntry();});
      if(entries.length!==want.size||new Set(entries.map(e=>e.fileName.toLowerCase())).size!==want.size)throw new Error('missing_files');
      total=entries.reduce((n,e)=>n+e.compressedSize,0);received=0;onProgress({phase:'downloading',completed:0,total,files:needed.length});
      for(const entry of entries){
        const name=entry.fileName;safeRelative?.(name);const kind=(entry.externalFileAttributes>>>16)&0xf000;
        if(kind&&kind!==0x8000)throw new Error('non_regular_file');
        const f=want.get(name.toLowerCase());if(f.path!==name||entry.uncompressedSize!==f.size)throw new Error('unexpected_file');
        const dest=sourceOf(target,f);await fsp.mkdir(path.dirname(dest),{recursive:true});
        const input=await new Promise((r,j)=>zip.openReadStream(entry,(e,s)=>e?j(e):r(s)));const check=hashing(f);
        await pipeline(input,check,fs.createWriteStream(dest,{flags:'wx'}),{signal});
        if(!check.matches())throw new Error('file_hash_mismatch');
      }
    }finally{zip.close();}
  }catch(error){if(signal.aborted)throw new Error('download_timeout');throw error;}
  finally{clearTimeout(timer);}
}

/** ①+② — 성공하면 target에 서명된 목록의 파일이 전부 있다. 실패하면 던진다(target 정리는 부르는 쪽). */
async function stageDelta(m,currentRoot,target,fetchImpl,options={}){
  const needed=await copyReusable(m,currentRoot,target,options);
  await fetchNeeded(m,needed,target,fetchImpl,options);
  return {reused:m.files.length-needed.length,fetched:needed.length};
}
module.exports={stageDelta,copyReusable,fetchNeeded,RangeReader};
