const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync,spawn}=require('node:child_process');
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('native bootstrap verifies the signed file list, rolls back bad starts and keeps a healthy trial',{timeout:180000},()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),jwk=pair.publicKey.export({format:'jwk'});
  const xml=`<RSAKeyValue><Modulus>${Buffer.from(jwk.n,'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e,'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
  // legacy = 옛 설치 폴더에 새 실행기만 들어온 경우(aywa-install.json 없음 — 설치본 순번 모름, 1.0.13).
  for(const legacy of [false,true])for(const scenario of ['healthy','bad-start','corrupt-file','wrong-signature','malformed-journal']){
    const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/bootstrap-test-')),profile=path.join(root,'profile'),version=path.join(profile,'versions','2');fs.mkdirSync(path.join(version,'resources'),{recursive:true});
    const source=fs.readFileSync(path.resolve(__dirname,'../native/Bootstrap.cs'),'utf8').replace('__PUBLIC_KEY_XML__',xml).replace(/static string root=Path.Combine\([^\n]+;/,`static string root=${JSON.stringify(profile)};`).replace(/MessageBox.Show\([^;]+;/,'File.WriteAllText(Path.Combine(root,"unexpected-error"),"error");')
    .replace(/AYWA\.Sync\.(Bootstrap|Show)/g,m=>`${m}.Test.${path.basename(root)}`);
    const bootstrapSource=path.join(root,'Bootstrap.cs');fs.writeFileSync(bootstrapSource,source);if(!legacy)fs.writeFileSync(path.join(root,'aywa-install.json'),JSON.stringify({sequence:1}));
    execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(root,'AywaSync.exe')}`,'/r:System.Web.Extensions.dll','/r:System.Windows.Forms.dll',bootstrapSource],{windowsHide:true,stdio:'pipe'});
    const runtimeSource=path.join(root,'Runtime.cs');fs.writeFileSync(runtimeSource,'using System;using System.IO;class Runtime{static void Main(){File.AppendAllText(Path.Combine('+JSON.stringify(profile)+',"runs"),Environment.GetEnvironmentVariable("AYWA_SEQUENCE")+"\\n");File.WriteAllText(Environment.GetEnvironmentVariable("AYWA_HEALTH_FILE"),"ready");}}');
    execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(root,'AywaSyncRuntime.exe')}`,runtimeSource],{windowsHide:true,stdio:'pipe'});
    if(scenario==='bad-start'){
      fs.writeFileSync(runtimeSource,'class Runtime{static int Main(){return 1;}}');execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(version,'AywaSyncRuntime.exe')}`,runtimeSource],{windowsHide:true,stdio:'pipe'});
    }else fs.copyFileSync(path.join(root,'AywaSyncRuntime.exe'),path.join(version,'AywaSyncRuntime.exe'));
    fs.writeFileSync(path.join(version,'resources/app.asar'),'fixture');
    const files=['AywaSyncRuntime.exe','resources/app.asar'].map(p=>({path:p,size:fs.statSync(path.join(version,p)).size,sha256:sha(path.join(version,p))}));
    const bytes=Buffer.from(JSON.stringify({protocol:1,sequence:2,files})),signature=crypto.sign('RSA-SHA256',bytes,pair.privateKey).toString('base64');
    fs.writeFileSync(path.join(version,'release.json'),JSON.stringify({payload:bytes.toString('base64'),signature:scenario==='wrong-signature'?'AA==':signature}));
    if(scenario==='corrupt-file')fs.appendFileSync(path.join(version,'AywaSyncRuntime.exe'),'tampered');
    fs.writeFileSync(path.join(profile,'launch.json'),JSON.stringify(scenario==='malformed-journal'?{current:{wrong:true}}:{current:2,previous:1,trial:true,failed:[]}));
    execFileSync(path.join(root,'AywaSync.exe'),[],{windowsHide:true,timeout:15000});
    const label=`${scenario}${legacy?' (legacy install)':''}`;
    assert.equal(fs.existsSync(path.join(profile,'unexpected-error')),false,label);
    // 모르는 설치본은 순번 0으로 설치 폴더 본체를 띄운다(옛 실행기와 같은 자리) — 되돌릴 곳(1)도 버전 폴더가 없으니 설치 폴더 본체다.
    assert.equal(fs.readFileSync(path.join(profile,'runs'),'utf8').trim(),scenario==='healthy'?'2':legacy&&scenario==='malformed-journal'?'0':'1',label);
    if(scenario!=='malformed-journal'){
      const journal=JSON.parse(fs.readFileSync(path.join(profile,'launch.json'),'utf8'));assert.equal(journal.current,scenario==='healthy'?2:1,label);assert.equal(journal.trial,false,label);if(scenario!=='healthy')assert.ok(journal.failed.includes(2),label);
    }
  }
});
test('native bootstrap keeps relaunching after repeated update exits (42) — 업데이트 세 번째부터 앱이 사라지지 않는다(1.0.7)',{timeout:60000},()=>{
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/bootstrap-42-')),profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
  const source=fs.readFileSync(path.resolve(__dirname,'../native/Bootstrap.cs'),'utf8').replace('__PUBLIC_KEY_XML__','<RSAKeyValue><Modulus>AQAB</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>')
    .replace(/static string root=Path.Combine\([^\n]+;/,`static string root=${JSON.stringify(profile)};`).replace(/MessageBox.Show\([^;]+;/,'File.WriteAllText(Path.Combine(root,"unexpected-error"),"error");')
    .replace(/AYWA\.Sync\.(Bootstrap|Show)/g,m=>`${m}.Test.${path.basename(root)}`);
  const bootstrapSource=path.join(root,'Bootstrap.cs');fs.writeFileSync(bootstrapSource,source);fs.writeFileSync(path.join(root,'aywa-install.json'),JSON.stringify({sequence:1}));
  execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(root,'AywaSync.exe')}`,'/r:System.Web.Extensions.dll','/r:System.Windows.Forms.dll',bootstrapSource],{windowsHide:true,stdio:'pipe'});
  // 가짜 앱: 1~3번째는 건강 확인 뒤 42, 4~6번째는 건강 확인 전 42(두 경로 각각 세 번 — 한쪽만 고쳐져도 실패한다) · 7번째는 정상 종료.
  const runtimeSource=path.join(root,'Runtime.cs');
  fs.writeFileSync(runtimeSource,'using System;using System.IO;class Runtime{static int Main(){var runs=Path.Combine('+JSON.stringify(profile)+',"runs");File.AppendAllText(runs,"x"+Environment.NewLine);int n=File.ReadAllLines(runs).Length;'
    +'if(n<=3||n==7)File.WriteAllText(Environment.GetEnvironmentVariable("AYWA_HEALTH_FILE"),"ready");return n<7?42:0;}}');
  execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(root,'AywaSyncRuntime.exe')}`,runtimeSource],{windowsHide:true,stdio:'pipe'});
  execFileSync(path.join(root,'AywaSync.exe'),[],{windowsHide:true,timeout:30000});
  assert.equal(fs.existsSync(path.join(profile,'unexpected-error')),false);
  assert.equal(fs.readFileSync(path.join(profile,'runs'),'utf8').trim().split(/\r?\n/).length,7);
});
// 실행기를 컴파일한다(지점 폴더 = 시험 폴더 · 잠금·신호 이름도 시험 전용 — 같은 PC에서 진짜 앱이 돌아도 섞이지 않게). 1.0.13 시험용.
function compileLauncher(sourceFile,root,profile,out){
  const source=fs.readFileSync(sourceFile,'utf8').replace('__PUBLIC_KEY_XML__','<RSAKeyValue><Modulus>AQAB</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>').replace('__SEQUENCE__','1')
    .replace(/static string root=Path.Combine\([^\n]+;/,`static string root=${JSON.stringify(profile)};`).replace(/MessageBox.Show\([^;]+;/,'File.WriteAllText(Path.Combine(root,"unexpected-error"),"error");')
    .replace(/AYWA\.Sync\.(Bootstrap|Show)/g,m=>`${m}.Test.${path.basename(root)}`).replace('const int ShowSinceSequence = 15;','const int ShowSinceSequence = 1;');
  const file=path.join(root,path.basename(out,'.exe')+'.cs');fs.writeFileSync(file,source);
  execFileSync(csc,['/nologo','/target:winexe',`/out:${out}`,'/r:System.Web.Extensions.dll','/r:System.Windows.Forms.dll',file],{windowsHide:true,stdio:'pipe'});
}
function launcherFixture(prefix,runtimeBody,{field=false}={}){
  const root=fs.mkdtempSync(path.resolve(__dirname,`../../../work/${prefix}-`)),profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(root,'aywa-install.json'),JSON.stringify({sequence:1}));
  compileLauncher(path.resolve(__dirname,'../native/Bootstrap.cs'),root,profile,path.join(root,'AywaSync.exe'));
  // field = 현장 PC의 옛 실행기(2026-10-15 설치본)를 앞 실행기로 — 넘겨받기는 이 실행기에서 일어난다.
  if(field)compileLauncher(path.resolve(__dirname,'fixtures/field-launcher-2026-10-15.cs'),root,profile,path.join(root,'FieldLauncher.exe'));
  const runtimeSource=path.join(root,'Runtime.cs');
  fs.writeFileSync(runtimeSource,'using System;using System.IO;using System.Linq;using System.Threading;using System.Diagnostics;class Runtime{static int Main(string[] args){string profile='+JSON.stringify(profile)+',runs=Path.Combine(profile,"runs"),launcher='+JSON.stringify(path.join(root,'AywaSync.exe'))+';'+runtimeBody+'}}');
  execFileSync(csc,['/nologo','/target:winexe',`/out:${path.join(root,'AywaSyncRuntime.exe')}`,runtimeSource],{windowsHide:true,stdio:'pipe'});
  return {root,profile,runs:path.join(profile,'runs'),launcher:path.join(root,'AywaSync.exe'),field:path.join(root,'FieldLauncher.exe')};
}
const lines=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean):[];
async function until(check,ms,label){const end=Date.now()+ms;while(Date.now()<end){if(check())return;await new Promise(r=>setTimeout(r,150));}assert.fail(`timeout: ${label}`);}
test('the field launcher (2026-10-15) hands over to a new launcher that waits for its lock — 옛 실행기의 42 세기를 타지 않는다(1.0.13)',{timeout:90000},async()=>{
  // 1번째 본체(옛 실행기가 띄움): 건강 확인 → 새 실행기를 --handover로 띄우고 '기다리는 중' 표식을 본 뒤 0으로 끝(main.cjs exitForUpdate와 같은 순서).
  // 옛 실행기는 건강 확인 뒤 0이면 잠금을 놓지 않고 끝난다(abandoned) → 새 실행기가 이어 받아 2번째 본체를 띄운다.
  const f=launcherFixture('bootstrap-handover','File.AppendAllText(runs,"run launcher="+Environment.GetEnvironmentVariable("AYWA_LAUNCHER")+" args="+string.Join(" ",args)+Environment.NewLine);'
    +'File.WriteAllText(Environment.GetEnvironmentVariable("AYWA_HEALTH_FILE"),"ready");'
    +'if(File.ReadAllLines(runs).Length==1){Thread.Sleep(1500);string ready=Path.Combine(profile,"handover-1");Process.Start(new ProcessStartInfo(launcher,"--handover --hidden --handover-ready="+ready){UseShellExecute=false});'
    +'for(int i=0;i<100&&!File.Exists(ready);i++)Thread.Sleep(100);File.AppendAllText(runs,"ready="+File.Exists(ready)+Environment.NewLine);}return 0;',{field:true});
  execFileSync(f.field,['--hidden'],{windowsHide:true,timeout:30000});
  await until(()=>lines(f.runs).length>=3,20000,'second runtime');await new Promise(r=>setTimeout(r,800));
  assert.equal(fs.existsSync(path.join(f.profile,'unexpected-error')),false);
  assert.deepEqual(lines(f.runs),['run launcher= args=--hidden','ready=True','run launcher=2 args=--hidden']);
});
test('a second launch asks the owner to show the window and never starts a second runtime itself(1.0.13)',{timeout:60000},async()=>{
  // 주인 본체: 건강 확인 뒤 stop 파일이 생길 때까지 돈다. --show 본체: 기록만 남기고 끝(실제 본체는 주인에게 창을 띄우라고 넘기고 끝난다).
  const f=launcherFixture('bootstrap-show','if(args.Contains("--show")){File.AppendAllText(runs,"show"+Environment.NewLine);return 0;}File.AppendAllText(runs,"primary"+Environment.NewLine);'
    +'File.WriteAllText(Environment.GetEnvironmentVariable("AYWA_HEALTH_FILE"),"ready");for(int i=0;i<200&&!File.Exists(Path.Combine(profile,"stop"));i++)Thread.Sleep(100);return 0;');
  const owner=spawn(f.launcher,['--hidden'],{windowsHide:true});const exited=new Promise(r=>owner.once('exit',r));
  await until(()=>lines(f.runs).includes('primary'),15000,'primary');await new Promise(r=>setTimeout(r,1200));
  execFileSync(f.launcher,[],{windowsHide:true,timeout:15000});
  await until(()=>lines(f.runs).includes('show'),10000,'show forwarded');
  fs.writeFileSync(path.join(f.profile,'stop'),'1');await exited;
  assert.equal(fs.existsSync(path.join(f.profile,'unexpected-error')),false);
  assert.deepEqual(lines(f.runs),['primary','show']);
});
test('the launcher self-test writes only its version inside the profile and starts nothing(1.0.13)',{timeout:60000},()=>{
  const f=launcherFixture('bootstrap-selftest','File.AppendAllText(runs,"run"+Environment.NewLine);return 0;');
  execFileSync(f.launcher,[`--selftest=${path.join(f.profile,'selftest-1')}`],{windowsHide:true,timeout:15000});
  assert.equal(fs.readFileSync(path.join(f.profile,'selftest-1'),'utf8'),'launcher:2');
  // 지점 폴더 밖·다른 이름은 쓰지 않는다.
  execFileSync(f.launcher,[`--selftest=${path.join(f.root,'selftest-2')}`],{windowsHide:true,timeout:15000});execFileSync(f.launcher,[`--selftest=${path.join(f.profile,'other-3')}`],{windowsHide:true,timeout:15000});
  assert.equal(fs.existsSync(path.join(f.root,'selftest-2')),false);assert.equal(fs.existsSync(path.join(f.profile,'other-3')),false);
  // 본체는 넣을 자리의 이름(AywaSync.exe.new) 그대로 자가 시험한다 — 확장자가 달라도 돈다.
  fs.copyFileSync(f.launcher,path.join(f.root,'AywaSync.exe.new'));
  execFileSync(path.join(f.root,'AywaSync.exe.new'),[`--selftest=${path.join(f.profile,'selftest-4')}`],{windowsHide:true,timeout:15000});
  assert.equal(fs.readFileSync(path.join(f.profile,'selftest-4'),'utf8'),'launcher:2');
  assert.deepEqual(lines(f.runs),[]);
});
test('a runtime that cannot take the single-instance lock (43) is retried, not rolled back(1.0.13)',{timeout:60000},()=>{
  // 1번째: 잠금을 못 잡음(43, 건강 확인 전) · 2번째: 정상. 시험 실행 중이어도 되돌리거나 격리하지 않는다.
  const f=launcherFixture('bootstrap-43','File.AppendAllText(runs,"x"+Environment.NewLine);if(File.ReadAllLines(runs).Length==1)return 43;File.WriteAllText(Environment.GetEnvironmentVariable("AYWA_HEALTH_FILE"),"ready");return 0;');
  execFileSync(f.launcher,[],{windowsHide:true,timeout:30000});
  assert.equal(fs.existsSync(path.join(f.profile,'unexpected-error')),false);
  assert.equal(lines(f.runs).length,2);
});
