// Verify and extract the real signed full update with the production updater. No network/launch.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {verifyManifest,extractVerified}=require('../lib/update.cjs');
async function main(){
  const build=require('../build-config.json'),directory=path.resolve(__dirname,'../dist/release',String(build.sequence));
  const envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8'));
  const manifest=verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});
  const archive=path.join(directory,`AywaSync-${build.version}.zip`),hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of fs.createReadStream(archive)){size+=chunk.length;hash.update(chunk);}assert.equal(size,manifest.size);assert.equal(hash.digest('hex'),manifest.sha256);
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-release-')),out=path.join(root,'verified');
  await extractVerified(archive,out,manifest);
  console.log(JSON.stringify({passed:true,sequence:manifest.sequence,version:manifest.version,archiveBytes:manifest.size,files:manifest.files.length,manifestPayloadBytes:envelope.payload.length,evidence:root}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
