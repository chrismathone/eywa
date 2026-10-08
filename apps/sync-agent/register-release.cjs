// Default: verify local immutable release only. --verify-remote checks hosted files.
// --apply verifies hosted files, then registers the release. It does not upload or migrate schema.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const {verifyManifest}=require('./lib/update.cjs');
async function hashStream(stream,limit=Infinity){const h=crypto.createHash('sha256');let size=0;for await(const c of stream){size+=c.length;if(size>limit)throw new Error('Release file exceeds declared size');h.update(c);}return{size,sha256:h.digest('hex')};}
async function main(){
  const options=new Set(process.argv.slice(2));for(const option of options)if(!['--verify-remote','--apply'].includes(option))throw new Error('Unknown option');
  const build=require('./build-config.json'),directory=path.join(__dirname,'dist/release',String(build.sequence));
  const envelope=JSON.parse(fs.readFileSync(path.join(directory,'release.json'),'utf8')),checks=JSON.parse(fs.readFileSync(path.join(directory,'checksums.json'),'utf8'));
  const manifest=verifyManifest(envelope,build.publicKey,{sequence:build.sequence-1});assert.equal(manifest.sequence,build.sequence);assert.equal(manifest.version,build.version);
  const installer=`AywaSync-Setup-${build.version}.exe`,archive=`AywaSync-${build.version}.zip`;
  const expected=[{name:installer,url:checks.installerUrl,sha256:checks.installerSha256,size:fs.statSync(path.join(directory,installer)).size},{name:archive,url:manifest.url,sha256:manifest.sha256,size:manifest.size}];
  for(const file of expected){const actual=await hashStream(fs.createReadStream(path.join(directory,file.name)));assert.deepEqual(actual,{size:file.size,sha256:file.sha256},'Local release file changed');}
  if(options.has('--verify-remote')||options.has('--apply'))for(const file of expected){
    const url=new URL(file.url);assert.equal(url.protocol,'https:');assert.ok(!url.username&&!url.password&&!url.search&&!url.hash);
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20*60*1000)});assert.equal(response.status,200,'Hosted release is unavailable');
    const actual=await hashStream(response.body,file.size);assert.deepEqual(actual,{size:file.size,sha256:file.sha256},'Hosted release differs from verified build');
  }
  if(options.has('--apply')){
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required only for --apply');
    const sql=require('../../node_modules/postgres')(process.env.DATABASE_URL,{prepare:false,max:1});
    try{await sql.begin(async tx=>{
      await tx`lock table sync_agent_releases in exclusive mode`;
      const [latest]=await tx`select sequence from sync_agent_releases order by sequence desc limit 1`;
      if(latest&&Number(latest.sequence)>=build.sequence)throw new Error('Sequence is already registered; release files are immutable');
      await tx`insert into sync_agent_releases(version,sequence,manifest,signature,installer_url) values(${build.version},${build.sequence},${tx.json({payload:envelope.payload})},${envelope.signature},${checks.installerUrl})`;
    });}finally{await sql.end();}
  }
  console.log(JSON.stringify({verified:true,remoteVerified:options.has('--verify-remote')||options.has('--apply'),registered:options.has('--apply'),sequence:build.sequence,version:build.version}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
