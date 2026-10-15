const fs=require('node:fs');const path=require('node:path');const {spawn,spawnSync}=require('node:child_process');const assert=require('node:assert/strict');
async function main(){
  const resources=path.resolve(__dirname,'../dist/win-unpacked/resources'),root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-runtime-'));
  const script=path.join(root,'probe.cjs'),result=path.join(root,'result.json');
  fs.writeFileSync(script,`const fs=require('node:fs');const {execFileSync}=require('node:child_process');
    (async()=>{const {chromium}=require(${JSON.stringify(path.join(resources,'runtime/node_modules/playwright'))});const browser=await chromium.launch({headless:true});
    const page=await browser.newPage();let requests=0;await page.route('**/*',r=>{requests++;return r.abort();});await page.setContent('<h1>AYWA local runtime probe</h1>');
    await page.screenshot({path:${JSON.stringify(path.join(root,'browser.png'))}});await browser.close();
    execFileSync(${JSON.stringify(path.join(resources,'ffmpeg/ffmpeg.exe'))},['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-c:v','libx264','-pix_fmt','yuv420p',${JSON.stringify(path.join(root,'video.mp4'))}],{windowsHide:true});
    fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({node:process.versions.node,requests,browser:true,ffmpeg:true}));})().catch(e=>{console.error(e);process.exit(1);});`);
  const env={...process.env,ELECTRON_RUN_AS_NODE:'1',PLAYWRIGHT_BROWSERS_PATH:path.join(resources,'browsers')};for(const key of ['DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS'])delete env[key];
  const host=spawn(path.join(resources,'WorkerHost.exe'),[path.resolve(__dirname,'../dist/win-unpacked/AywaSyncRuntime.exe'),script],{cwd:path.join(resources,'runtime'),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let error='';host.stderr.on('data',c=>error+=c);const code=await new Promise((resolve,reject)=>{host.on('error',reject);host.on('exit',resolve);setTimeout(()=>{host.stdin.destroy();reject(new Error('runtime timeout'));},30000).unref();});
  assert.equal(code,0,error);const data=JSON.parse(fs.readFileSync(result,'utf8'));assert.equal(data.requests,0);
  // The updater runs inside Electron, whose fs treats *.asar paths as archives. Plain-node tests passed while every real PC update failed, so run them in the packaged runtime too.
  const updateTests=spawnSync(path.resolve(__dirname,'../dist/win-unpacked/AywaSyncRuntime.exe'),['--test',path.join(__dirname,'update.test.cjs')],{cwd:path.resolve(__dirname,'..'),env,encoding:'utf8',timeout:120000,windowsHide:true});
  assert.equal(updateTests.status,0,`update tests failed in the packaged runtime\n${updateTests.stdout}\n${updateTests.stderr}`);
  console.log(JSON.stringify({passed:true,...data,updateTestsInRuntime:true,evidence:root}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
