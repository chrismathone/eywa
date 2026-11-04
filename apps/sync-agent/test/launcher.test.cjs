const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync,spawn}=require('node:child_process');
const {launcherVersion,installedSequenceOf,refreshInstalledLauncher,handoverTarget,handoverEnv,cleanupOldLaunchers,signedLauncherSha}=require('../lib/launcher.cjs');
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tmp=prefix=>fs.mkdtempSync(path.resolve(__dirname,`../../../work/${prefix}-`));
const pass=async()=>true,fail=async()=>false;
async function until(check,ms,label){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,100));}assert.fail(`timeout: ${label}`);}
// 옛 설치 폴더: 실행기 판·설치본 순번 표식 없음 · 본체 순번은 resources/app.asar/build-config.json(Electron에선 asar 안 파일, 여기선 같은 경로의 폴더).
function legacyInstall(root,sequence=7){const dir=path.join(root,'install');fs.mkdirSync(path.join(dir,'resources','app.asar'),{recursive:true});fs.writeFileSync(path.join(dir,'resources','app.asar','build-config.json'),JSON.stringify({sequence}));return dir;}
test('the runtime replaces a running old launcher only after its signed hash and self-test pass, and never downgrades it(1.0.13)',{timeout:60000},async()=>{
  const root=tmp('launcher-refresh'),installDir=legacyInstall(root),ownDir=path.join(root,'versions','14');fs.mkdirSync(ownDir,{recursive:true});
  // 설치 폴더 = 지금 돌고 있는 옛 실행기(판 표시 없음). 버전 폴더 = 새 실행기(판 2).
  const source=path.join(root,'Old.cs');fs.writeFileSync(source,`using System.IO;using System.Threading;class Old{static void Main(){File.WriteAllText(${JSON.stringify(path.join(root,'started'))},"1");for(int i=0;i<300&&!File.Exists(${JSON.stringify(path.join(root,'stop'))});i++)Thread.Sleep(100);}}`);
  execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(installDir,'AywaSync.exe')}`,source],{windowsHide:true,stdio:'pipe'});
  fs.writeFileSync(path.join(ownDir,'AywaSync.exe'),'new launcher bytes');fs.writeFileSync(path.join(ownDir,'aywa-launcher.json'),JSON.stringify({launcher:2}));
  const oldHash=sha(path.join(installDir,'AywaSync.exe')),newHash=sha(path.join(ownDir,'AywaSync.exe'));
  const running=spawn(path.join(installDir,'AywaSync.exe'),[],{windowsHide:true});const exited=new Promise(r=>running.once('exit',r));
  try{
    await until(()=>fs.existsSync(path.join(root,'started')),10000,'old launcher running');
    assert.equal(launcherVersion(installDir),1);
    // 서명 목록과 다른 실행기 · 자가 시험 실패 → 넣지 않는다(옛 실행기 그대로, 복사본도 안 남김).
    await assert.rejects(refreshInstalledLauncher({installDir,ownDir,expectedSha:'0'.repeat(64),selftest:pass}),/launcher_not_signed/);
    await assert.rejects(refreshInstalledLauncher({installDir,ownDir,expectedSha:newHash,selftest:fail}),/launcher_selftest_failed/);
    assert.equal(sha(path.join(installDir,'AywaSync.exe')),oldHash);assert.equal(fs.existsSync(path.join(installDir,'AywaSync.exe.new')),false);
    // 자가 시험은 넣을 그 자리(.new)에서, 판 숫자와 함께.
    const tried=[];
    assert.deepEqual(await refreshInstalledLauncher({installDir,ownDir,expectedSha:newHash,selftest:async(exe,version)=>{tried.push([path.basename(exe),version,sha(exe)]);return true;}}),{status:'updated',version:2});
    assert.deepEqual(tried,[['AywaSync.exe.new',2,newHash]]);
    assert.equal(sha(path.join(installDir,'AywaSync.exe')),newHash);assert.equal(launcherVersion(installDir),2);
    // 옛 설치 폴더에 설치본 순번을 적어 둔다 — 새 실행기가 '버전 폴더 없는 순번'을 설치본으로 착각하지 않게.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installDir,'aywa-install.json'),'utf8')),{sequence:7});assert.equal(installedSequenceOf(installDir),7);
    assert.equal(fs.readdirSync(installDir).filter(n=>/^AywaSync\.exe\.old-\d+$/.test(n)).length,1,'running launcher was moved aside');
    // 다시 돌려도 그대로 · 되돌린 옛 버전(판 1)이 새 실행기를 낮추지 않는다 · 설치본을 그대로 도는 본체는 바꿀 것이 없다.
    assert.deepEqual(await refreshInstalledLauncher({installDir,ownDir,expectedSha:newHash,selftest:pass}),{status:'current',version:2});
    fs.writeFileSync(path.join(ownDir,'aywa-launcher.json'),JSON.stringify({launcher:1}));assert.deepEqual(await refreshInstalledLauncher({installDir,ownDir,selftest:pass}),{status:'current',version:2});
    assert.deepEqual(await refreshInstalledLauncher({installDir,ownDir:installDir,selftest:pass}),{status:'same'});
    assert.equal(cleanupOldLaunchers(installDir),0,'still running — kept');
  }finally{fs.writeFileSync(path.join(root,'stop'),'1');await exited;}
  await until(()=>cleanupOldLaunchers(installDir)===1,5000,'old launcher removed after exit');
  assert.deepEqual(fs.readdirSync(installDir).sort(),['AywaSync.exe','aywa-install.json','aywa-launcher.json','resources']);
});
test('handover uses the install folder launcher when it is new, otherwise a self-tested copy beside the profile(1.0.13)',async()=>{
  const root=tmp('launcher-handover'),installDir=legacyInstall(root),dataRoot=path.join(root,'profile'),ownDir=path.join(dataRoot,'versions','14');fs.mkdirSync(ownDir,{recursive:true});
  fs.writeFileSync(path.join(installDir,'AywaSync.exe'),'old');fs.writeFileSync(path.join(ownDir,'AywaSync.exe'),'new');fs.writeFileSync(path.join(ownDir,'aywa-launcher.json'),JSON.stringify({launcher:2}));
  // 설치 폴더가 옛 판(바꾸지 못함) → 지점 폴더 launcher\ 복사본 + 설치 폴더·설치본 순번을 알려 준다. 버전 폴더의 실행기는 쓰지 않는다.
  await assert.rejects(handoverTarget({installDir,ownDir,dataRoot,selftest:fail}),/launcher_selftest_failed/);
  const copy=await handoverTarget({installDir,ownDir,dataRoot,expectedSha:sha(path.join(ownDir,'AywaSync.exe')),selftest:pass});
  assert.equal(copy.exe,path.join(dataRoot,'launcher','AywaSync.exe'));assert.deepEqual(copy.args,['--handover','--hidden',`--install-dir=${path.resolve(installDir)}`,'--install-sequence=7']);
  assert.equal(fs.readFileSync(copy.exe,'utf8'),'new');assert.equal(launcherVersion(path.dirname(copy.exe)),2);
  // 새 판 실행기가 없는 버전(되돌린 옛 버전)이면 넘기지 않는다 — 예전처럼 42.
  assert.equal(await handoverTarget({installDir,ownDir:installDir,dataRoot,selftest:pass}),null);
  // 설치 폴더가 이미 새 판이면 그것.
  fs.writeFileSync(path.join(installDir,'aywa-launcher.json'),JSON.stringify({launcher:2}));
  assert.deepEqual(await handoverTarget({installDir,ownDir,dataRoot,selftest:fail}),{exe:path.join(installDir,'AywaSync.exe'),args:['--handover','--hidden']});
  assert.deepEqual(handoverEnv({PATH:'x',AYWA_HEALTH_FILE:'h',aywa_trial:'1',ELECTRON_RUN_AS_NODE:'1',LOCALAPPDATA:'l'}),{PATH:'x',LOCALAPPDATA:'l'});
  // 서명 목록의 실행기 해시 — 목록에 없으면 넣지 않는다.
  fs.writeFileSync(path.join(ownDir,'release.json'),'{}');
  assert.equal(signedLauncherSha(ownDir,()=>({files:[{path:'AywaSync.exe',sha256:'a'.repeat(64)}]})),'a'.repeat(64));
  assert.throws(()=>signedLauncherSha(ownDir,()=>({files:[{path:'AywaSyncRuntime.exe',sha256:'b'.repeat(64)}]})),/launcher_not_listed/);
});
test('main.cjs wiring: --show never becomes primary, apply waits for the launcher, old launchers hand over only after the new one is waiting(1.0.13)',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  assert.match(main,/if\(!app\.requestSingleInstanceLock\(\)\)\{if\(process\.env\.AYWA_HEALTH_FILE&&!process\.argv\.includes\('--show'\)\)app\.exit\(43\);else app\.quit\(\);\}else if\(process\.argv\.includes\('--show'\)\)\{app\.releaseSingleInstanceLock\(\);app\.quit\(\);\}/);
  assert.match(main,/const applyUpdate=!closing&&launcherReady\(\)&&updatePlan\.shouldApply/);
  assert.match(main,/return Date\.now\(\)-healthGoneAt>=3000;/);
  assert.match(main,/atomicWrite\(file,'ready'\);healthReported=true;/);
  assert.match(main,/setTimeout\(refreshLauncher,5000\)/);
  assert.match(main,/await exitForUpdate\(\);/);
  // 비켜 둔 옛 실행기는 새 실행기가 본체를 띄워 증명한 뒤에만 지운다.
  assert.match(main,/else if\(Number\(process\.env\.AYWA_LAUNCHER\)>=launcherVersion\(installDir\)\)cleanupOldLaunchers\(installDir\);/);
  // 새 실행기(판 2 이상)만 42를 믿는다 · 옛 실행기면 넘겨받을 실행기가 '기다리는 중'을 알린 뒤에만 0으로 끝낸다.
  assert.match(main,/if\(Number\(process\.env\.AYWA_LAUNCHER\)>=2\|\|!app\.isPackaged\)\{app\.exit\(42\);return;\}/);
  assert.match(main,/if\(!fs\.existsSync\(ready\)\)throw new Error\('handover_not_ready'\);/);
  assert.match(main,/event\('worker_log','update','info',\{logCode:'launcher_handover'\}\);app\.exit\(0\);/);
  const bootstrap=fs.readFileSync(path.join(__dirname,'../native/Bootstrap.cs'),'utf8'),afterPack=fs.readFileSync(path.join(__dirname,'../after-pack.cjs'),'utf8');
  assert.match(bootstrap,/const int LauncherVersion = 2;/);assert.match(bootstrap,/start\.EnvironmentVariables\["AYWA_LAUNCHER"\]=LauncherVersion\.ToString\(\);/);
  assert.match(afterPack,/aywa-launcher\.json/);assert.match(afterPack,/aywa-install\.json/);
});
