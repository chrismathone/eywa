// Verify and extract the real signed full update with the production updater. No network/launch.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
// In the packaged runtime check the code shipped inside app.asar, not the source tree.
const {verifyManifest,extractVerified}=require(process.versions.electron?path.resolve(__dirname,'../dist/win-unpacked/resources/app.asar/lib/update.cjs'):'../lib/update.cjs');
async function main(){
  const build=require('../build-config.json'),directory=path.resolve(__dirname,'../dist/release',String(build.sequence));
  const envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
  const manifest=verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});
  const archive=path.join(directory,`AywaSync-${build.version}.zip`),hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of fs.createReadStream(archive)){size+=chunk.length;hash.update(chunk);}assert.equal(size,manifest.size);assert.equal(hash.digest('hex'),manifest.sha256);
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-release-')),out=path.join(root,'verified');
  await extractVerified(archive,out,manifest);
  // The second extraction only proves the runtime path; drop it (original-fs: the folder holds an app.asar).
  if(process.versions.electron)require('original-fs').rmSync(root,{recursive:true,force:true});
  console.log(JSON.stringify({passed:true,runtime:process.versions.electron?`electron ${process.versions.electron}`:`node ${process.versions.node}`,sequence:manifest.sequence,version:manifest.version,archiveBytes:manifest.size,files:manifest.files.length,manifestPayloadBytes:envelope.payload.length,evidence:process.versions.electron?'removed':root}));
  // The updater runs inside Electron, whose fs treats *.asar paths as archives: node passed this check while every PC update failed (1.0.1-1.0.4).
  if(!process.versions.electron){
    const env={...process.env,ELECTRON_RUN_AS_NODE:'1'};delete env.NODE_OPTIONS;
    const runtime=spawnSync(path.resolve(__dirname,'../dist/win-unpacked/AywaSyncRuntime.exe'),[__filename],{env,stdio:'inherit',timeout:30*60000,windowsHide:true});
    assert.equal(runtime.status,0,`release extraction failed in the packaged runtime${runtime.error?`: ${runtime.error.message}`:''}`);
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
