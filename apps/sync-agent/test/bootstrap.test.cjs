const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('native bootstrap verifies the signed file list, rolls back bad starts and keeps a healthy trial',{timeout:60000},()=>{
  const pair=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),jwk=pair.publicKey.export({format:'jwk'});
  const xml=`<RSAKeyValue><Modulus>${Buffer.from(jwk.n,'base64url').toString('base64')}</Modulus><Exponent>${Buffer.from(jwk.e,'base64url').toString('base64')}</Exponent></RSAKeyValue>`;
  for(const scenario of ['healthy','bad-start','corrupt-file','wrong-signature','malformed-journal']){
    const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/bootstrap-test-')),profile=path.join(root,'profile'),version=path.join(profile,'versions','2');fs.mkdirSync(path.join(version,'resources'),{recursive:true});
    const source=fs.readFileSync(path.resolve(__dirname,'../native/Bootstrap.cs'),'utf8').replace('__PUBLIC_KEY_XML__',xml).replace('__SEQUENCE__','1').replace(/static string root=Path.Combine\([^\n]+;/,`static string root=${JSON.stringify(profile)};`).replace(/MessageBox.Show\([^;]+;/,'File.WriteAllText(Path.Combine(root,"unexpected-error"),"error");');
    const bootstrapSource=path.join(root,'Bootstrap.cs');fs.writeFileSync(bootstrapSource,source);
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
    assert.equal(fs.existsSync(path.join(profile,'unexpected-error')),false,scenario);
    assert.equal(fs.readFileSync(path.join(profile,'runs'),'utf8').trim(),scenario==='healthy'?'2':'1',scenario);
    if(scenario!=='malformed-journal'){
      const journal=JSON.parse(fs.readFileSync(path.join(profile,'launch.json'),'utf8'));assert.equal(journal.current,scenario==='healthy'?2:1);assert.equal(journal.trial,false);if(scenario!=='healthy')assert.ok(journal.failed.includes(2));
    }
  }
});
test('native bootstrap keeps relaunching after repeated update exits (42) — 업데이트 세 번째부터 앱이 사라지지 않는다(1.0.7)',{timeout:60000},()=>{
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/bootstrap-42-')),profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});
  const source=fs.readFileSync(path.resolve(__dirname,'../native/Bootstrap.cs'),'utf8').replace('__PUBLIC_KEY_XML__','<RSAKeyValue><Modulus>AQAB</Modulus><Exponent>AQAB</Exponent></RSAKeyValue>').replace('__SEQUENCE__','1')
    .replace(/static string root=Path.Combine\([^\n]+;/,`static string root=${JSON.stringify(profile)};`).replace(/MessageBox.Show\([^;]+;/,'File.WriteAllText(Path.Combine(root,"unexpected-error"),"error");');
  const bootstrapSource=path.join(root,'Bootstrap.cs');fs.writeFileSync(bootstrapSource,source);
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
