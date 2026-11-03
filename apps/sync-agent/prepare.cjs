const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');const {builtinModules}=require('node:module');
const here=__dirname,repo=path.resolve(here,'../..'),build=path.join(here,'build'),runtime=path.join(build,'runtime');
const pkg=require('./package.json');const sequence=Number(process.env.EYWA_AGENT_SEQUENCE||1);if(!Number.isSafeInteger(sequence)||sequence<1)throw new Error('Invalid sequence');
fs.mkdirSync(build,{recursive:true});
execFileSync(process.execPath,[path.join(here,'build-icon.cjs')],{stdio:'inherit'});
execFileSync(process.execPath,[path.join(repo,'scripts/_sync-agent/build-query-catalog.cjs')],{cwd:repo,stdio:'inherit'});
const manifest=JSON.parse(fs.readFileSync(path.join(repo,'scripts/_sync-agent/runtime-manifest.json'),'utf8'));
for(const rel of manifest.sources){const dest=path.join(runtime,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});let source=fs.readFileSync(path.join(repo,rel),'utf8');
  const adapter=path.relative(path.dirname(dest),path.join(runtime,'scripts/_sync-agent/remote-db.cjs')).replaceAll('\\','/');
  source=source.replace(/from (["'])postgres\1/g,`from '${adapter}'`).replace(/require\((["'])postgres\1\)/g,`require('${adapter}')`);fs.writeFileSync(dest,source);
}
for(const name of ['remote-db.cjs','managed-worker.cjs']){const dest=path.join(runtime,'scripts/_sync-agent',name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(repo,'scripts/_sync-agent',name),dest);}
const dependencies={};for(const name of manifest.externals){if(builtinModules.includes(name)||name.startsWith('node:')||name==='postgres')continue;const rootName=name.startsWith('@')?name.split('/').slice(0,2).join('/'):name.split('/')[0];dependencies[rootName]=rootName==='iconv-lite'?'0.7.3':rootName==='playwright'?JSON.parse(fs.readFileSync(path.join(repo,'node_modules/@playwright/test/package.json'),'utf8')).version:JSON.parse(fs.readFileSync(path.join(repo,'node_modules',rootName,'package.json'),'utf8')).version;}
fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify({name:'aywa-worker-runtime',version:pkg.version,private:true,dependencies},null,2));
execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm install --omit=dev --no-audit --no-fund'],{cwd:runtime,stdio:'inherit',windowsHide:true});
const keyFile=process.env.EYWA_AGENT_SIGNING_KEY_FILE||path.join(process.env.LOCALAPPDATA,'AYWA','ReleaseKeys','sync-agent-private.pem');
if(!fs.existsSync(keyFile)){fs.mkdirSync(path.dirname(keyFile),{recursive:true});const pair=crypto.generateKeyPairSync('rsa',{modulusLength:3072,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});fs.writeFileSync(keyFile,pair.privateKey,{mode:0o600,flag:'wx'});}
const privateKey=crypto.createPrivateKey(fs.readFileSync(keyFile));const publicKey=crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'});const jwk=crypto.createPublicKey(privateKey).export({format:'jwk'});
const xml=`<RSAKeyValue><Modulus>${Buffer.from(jwk.n,'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e,'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
fs.writeFileSync(path.join(here,'build-config.json'),JSON.stringify({apiOrigin:'https://www.aywa.co.kr',version:pkg.version,sequence,publicKey},null,2));
const bootstrap=fs.readFileSync(path.join(here,'native/Bootstrap.cs'),'utf8').replace('__PUBLIC_KEY_XML__',xml);fs.writeFileSync(path.join(build,'Bootstrap.cs'),bootstrap);
const csc=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe');
execFileSync(csc,['/nologo','/target:exe',`/out:${path.join(build,'WorkerHost.exe')}`,path.join(here,'native','WorkerHost.cs')],{stdio:'inherit'});
execFileSync(csc,['/nologo','/target:winexe',`/win32icon:${path.join(build,'icon.ico')}`,`/out:${path.join(build,'AywaSync.exe')}`,'/r:System.Web.Extensions.dll','/r:System.Windows.Forms.dll',path.join(build,'Bootstrap.cs')],{stdio:'inherit'});
require('esbuild').buildSync({entryPoints:[path.join(repo,'src/features/sync-agent/protocol.ts')],outfile:path.join(here,'lib/protocol.cjs'),bundle:true,platform:'node',format:'cjs',external:['zod']});
const ffmpeg=process.env.EYWA_AGENT_FFMPEG_DIR||path.join(repo,'work/sync-agent-tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin');fs.mkdirSync(path.join(build,'ffmpeg'),{recursive:true});
for(const name of ['ffmpeg.exe','ffprobe.exe'])fs.copyFileSync(path.join(ffmpeg,name),path.join(build,'ffmpeg',name));
const license=path.resolve(ffmpeg,'../LICENSE');if(fs.existsSync(license))fs.copyFileSync(license,path.join(build,'ffmpeg','LICENSE.txt'));
const browserDir=path.join(build,'browsers');
execFileSync(process.execPath,[path.join(runtime,'node_modules/playwright/cli.js'),'install','chromium'],{cwd:runtime,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:browserDir},stdio:'inherit',windowsHide:true});
console.log(JSON.stringify({prepared:true,version:pkg.version,sequence,sources:manifest.sources.length,publicKeyFingerprint:crypto.createHash('sha256').update(publicKey).digest('hex')}));
