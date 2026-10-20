// Verify and extract the real signed full update with the production updater. No network/launch.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
// In the packaged runtime check the code shipped inside app.asar, not the source tree.
const lib=name=>process.versions.electron?path.resolve(__dirname,`../dist/win-unpacked/resources/app.asar/lib/${name}`):`../lib/${name}`;
const {verifyManifest,extractVerified,safeRelative}=require(lib('update.cjs'));const {stageDelta}=require(lib('update-delta.cjs'));
async function main(){
  const build=require('../build-config.json'),directory=path.resolve(__dirname,'../dist/release',String(build.sequence));
  const envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
  const manifest=verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});
  const archive=path.join(directory,`AywaSync-${build.version}.zip`),hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of fs.createReadStream(archive)){size+=chunk.length;hash.update(chunk);}assert.equal(size,manifest.size);assert.equal(hash.digest('hex'),manifest.sha256);
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-release-')),out=path.join(root,'verified');
  await extractVerified(archive,out,manifest);
  // 바뀐 파일만 받기(1.0.7) — 방금 푼 폴더를 '지금 버전'으로 삼아 세 파일을 바꾸거나 지운 뒤, 그 셋만 이 zip에서 범위 요청으로 받아 오는지.
  const ffs=process.versions.electron?require('original-fs'):fs,at=f=>path.join(out,...f.split('/'));
  const locale=manifest.files.find(f=>f.path.startsWith('locales/')&&f.size>0);const changed=['resources/app.asar','resources/runtime/package.json',locale.path];
  ffs.writeFileSync(at(changed[0]),'changed');ffs.rmSync(at(changed[1]));ffs.writeFileSync(at(changed[2]),Buffer.alloc(locale.size,1));
  const ranges=[];const rangeFetch=async(_url,init={})=>{const r=/^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range??'');assert.ok(r,'전체 받기를 하지 않는다');const s=Number(r[1]),e=Number(r[2]);ranges.push(e-s+1);
    const fd=fs.openSync(archive,'r'),buf=Buffer.alloc(e-s+1);fs.readSync(fd,buf,0,buf.length,s);fs.closeSync(fd);return new Response(buf,{status:206,headers:{'content-range':`bytes ${s}-${e}/${manifest.size}`}});};
  const delta=await stageDelta(manifest,out,path.join(root,'delta'),rangeFetch,{safeRelative});
  assert.deepEqual(delta,{reused:manifest.files.length-3,fetched:3});const deltaBytes=ranges.reduce((n,x)=>n+x,0);assert.ok(deltaBytes<manifest.size/5,`범위 요청 ${deltaBytes}바이트`);
  ffs.rmSync(path.join(root,'delta'),{recursive:true,force:true}); // 1.5GB — 증거로 둘 필요 없다
  // The second extraction only proves the runtime path; drop it (original-fs: the folder holds an app.asar).
  if(process.versions.electron)require('original-fs').rmSync(root,{recursive:true,force:true});
  console.log(JSON.stringify({passed:true,runtime:process.versions.electron?`electron ${process.versions.electron}`:`node ${process.versions.node}`,sequence:manifest.sequence,version:manifest.version,archiveBytes:manifest.size,files:manifest.files.length,manifestPayloadBytes:envelope.payload.length,delta:{reused:delta.reused,fetched:delta.fetched,rangeRequests:ranges.length,rangeBytes:deltaBytes},evidence:process.versions.electron?'removed':root}));
  // The updater runs inside Electron, whose fs treats *.asar paths as archives: node passed this check while every PC update failed (1.0.1-1.0.4).
  if(!process.versions.electron){
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_OPTIONS;
    const runtime=spawnSync(path.resolve(__dirname,'../dist/win-unpacked/AywaSyncRuntime.exe'),[__filename],{env,stdio:'inherit',timeout:30*60000,windowsHide:true});
    assert.equal(runtime.status,0,`release extraction failed in the packaged runtime${runtime.error?`: ${runtime.error.message}`:''}`);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
