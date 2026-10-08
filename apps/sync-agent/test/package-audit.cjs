// Static acceptance of the real bundle. Reads no production credentials and makes no requests.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'../../..'),app=path.resolve(__dirname,'..'),bundle=path.join(app,'dist/win-unpacked');
const manifest=require('../../../scripts/_sync-agent/runtime-manifest.json');
// Git may check text sources out as CRLF on Windows. Packaged LF is equivalent,
// while every other character must still match the source.
const textContents=buffer=>buffer.toString('utf8').replace(/\r\n/g,'\n');
const runtime=path.join(bundle,'resources/runtime');let verifiedSources=0;
for(const rel of manifest.sources){
  const file=path.join(runtime,rel),adapter=path.relative(path.dirname(file),path.join(runtime,'scripts/_sync-agent/remote-db.cjs')).replaceAll('\\','/');
  const expected=fs.readFileSync(path.join(root,rel),'utf8').replace(/from (["'])postgres\1/g,`from '${adapter}'`).replace(/require\((["'])postgres\1\)/g,`require('${adapter}')`);
  assert.equal(fs.readFileSync(file,'utf8'),expected,`Source mismatch: ${rel}`);verifiedSources++;
}
for(const name of ['remote-db.cjs','managed-worker.cjs'])assert.deepEqual(fs.readFileSync(path.join(runtime,'scripts/_sync-agent',name)),fs.readFileSync(path.join(root,'scripts/_sync-agent',name)));
const archive=path.join(bundle,'resources/app.asar');
for(const name of ['main.cjs','preload.cjs','lib/update.cjs','lib/update-plan.cjs','lib/supervisor.cjs','lib/lease.cjs','lib/broker.cjs','lib/storage.cjs','lib/legacy.cjs','lib/api.cjs','lib/protocol.cjs','build-config.json','ui/index.html','ui/app.js','ui/style.css'])
  assert.equal(textContents(asar.extractFile(archive,name)),textContents(fs.readFileSync(path.join(app,name))),`Application mismatch: ${name}`);
const files=fs.readdirSync(bundle,{recursive:true,withFileTypes:true}).filter(d=>d.isFile());
for(const d of files){const rel=path.relative(bundle,path.join(d.parentPath,d.name)).replaceAll('\\','/');
  assert.ok(!/(^|\/)\.env(?:\.|$)|sync-agent-private\.pem|(^|\/)connection\.bin$|(^|\/)session\.json$/i.test(rel),`Private artifact: ${rel}`);
}
assert.ok(!fs.existsSync(path.join(runtime,'node_modules/postgres')));
for(const name of ['AywaSync.exe','AywaSyncRuntime.exe','resources/WorkerHost.exe','resources/ffmpeg/ffmpeg.exe','resources/ffmpeg/ffprobe.exe'])assert.ok(fs.statSync(path.join(bundle,name)).size>0);
const installer=path.join(app,'dist',`AywaSync-Setup-${require('../package.json').version}.exe`);
const hash=crypto.createHash('sha256');const stream=fs.createReadStream(installer);
stream.on('data',c=>hash.update(c));stream.on('end',()=>console.log(JSON.stringify({passed:true,verifiedSources,files:files.length,installerBytes:fs.statSync(installer).size,installerSha256:hash.digest('hex')})));stream.on('error',e=>{throw e;});
