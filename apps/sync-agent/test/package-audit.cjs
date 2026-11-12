// Static acceptance of the real bundle. Reads no production credentials and makes no requests.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const crypto=require('node:crypto');
const asar=require('@electron/asar');
const root=path.resolve(__dirname,'../../..'),app=path.resolve(__dirname,'..'),bundle=path.join(app,'dist/win-unpacked');
const manifest=require('../../../scripts/_sync-agent/runtime-manifest.json');
for(const required of ['scripts/_shared/module-state.mjs','src/lib/module-state.mjs','scripts/_makeedu/seat-limit-alert.cjs'])
  assert.ok(manifest.sources.includes(required),`Required worker source missing: ${required}`);
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
for(const name of ['main.cjs','preload.cjs','lib/update.cjs','lib/update-plan.cjs','lib/supervisor.cjs','lib/lease.cjs','lib/broker.cjs','lib/storage.cjs','lib/worker-log.cjs','lib/legacy.cjs','lib/launcher.cjs','lib/api.cjs','lib/protocol.cjs','build-config.json','ui/index.html','ui/app.js','ui/style.css'])
  assert.equal(textContents(asar.extractFile(archive,name)),textContents(fs.readFileSync(path.join(app,name))),`Application mismatch: ${name}`);
const files=fs.readdirSync(bundle,{recursive:true,withFileTypes:true}).filter(d=>d.isFile());
for(const d of files){const rel=path.relative(bundle,path.join(d.parentPath,d.name)).replaceAll('\\','/');
  assert.ok(!/(^|\/)\.env(?:\.|$)|sync-agent-private\.pem|(^|\/)connection\.bin$|(^|\/)session\.json$/i.test(rel),`Private artifact: ${rel}`);
}
assert.ok(!fs.existsSync(path.join(runtime,'node_modules/postgres')));
for(const name of ['AywaSync.exe','AywaSyncRuntime.exe','resources/WorkerHost.exe','resources/ffmpeg/ffmpeg.exe','resources/ffmpeg/ffprobe.exe'])assert.ok(fs.statSync(path.join(bundle,name)).size>0);
// 실행기 판·설치본 순번 표식(1.0.13) — 본체가 설치 폴더 실행기를 바꾸는 근거라 빠지면 옛 실행기가 계속 남는다.
const launcherVersion=Number(/const int LauncherVersion = (\d+);/.exec(fs.readFileSync(path.join(app,'native/Bootstrap.cs'),'utf8'))[1]);
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle,'aywa-launcher.json'),'utf8')),{launcher:launcherVersion});
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(bundle,'aywa-install.json'),'utf8')),{sequence:require('../build-config.json').sequence});
const installer=path.join(app,'dist',`AywaSync-Setup-${require('../package.json').version}.exe`);
const hash=crypto.createHash('sha256');const stream=fs.createReadStream(installer);
stream.on('data',c=>hash.update(c));stream.on('end',()=>console.log(JSON.stringify({passed:true,verifiedSources,files:files.length,installerBytes:fs.statSync(installer).size,installerSha256:hash.digest('hex')})));stream.on('error',e=>{throw e;});
