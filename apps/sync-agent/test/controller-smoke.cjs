const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');
const {_electron}=require('../build/runtime/node_modules/playwright');
async function main(){
  const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/agent-controller-')),env={...process.env,LOCALAPPDATA:root,APPDATA:path.join(root,'Roaming')};
  for(const key of ['ELECTRON_RUN_AS_NODE','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS'])delete env[key];
  const executable=path.resolve(__dirname,'../node_modules/electron/dist/electron.exe'),args=[path.resolve(__dirname,'..')];
  const electron=await _electron.launch({executablePath:executable,args,env});
  try{
    // All application network requests are intercepted before the first pairing action.
    // Both modules are off, so no operational worker or external service is started.
    await electron.evaluate(({app})=>{
      global.fixture={calls:[],login:[],revoked:false};app.setLoginItemSettings=options=>global.fixture.login.push(options);
      const tenantId='bd4a636a-5356-483f-bf1c-b615067a7426';
      global.fetch=async(url,init)=>{
        if(!String(url).startsWith('https://www.aywa.co.kr/api/sync-agent/'))throw new Error('external request blocked');
        const action=String(url).split('/').pop(),body=JSON.parse(init.body);global.fixture.calls.push(action);let value;
        const config={protocol:1,tenantId,tenantName:'가상 검증 지점',enabled:false,classnoteEnabled:false,makeeduEnabled:false,updatesEnabled:false,cutoverReady:true,revision:1};
        if(action==='pair'){global.fixture.secret=body.secret;value={deviceId:body.deviceId,tenantId,tenantName:config.tenantName,protocol:1};}
        else if(action==='acquire')value={generation:'1',remainingMs:90000};
        else if(action==='heartbeat')value={remainingMs:90000,config};
        else if(action==='events')value={accepted:body.events.map(e=>e.id)};
        else if(action==='configuration'){if(global.fixture.revoked)return new Response(JSON.stringify({error:'unauthorized'}),{status:401});value=config;}
        else if(action==='release')value={ok:true};else throw new Error('unexpected fixture operation '+action);
        return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
      };
    });
    const page=await electron.firstWindow();await page.getByLabel('지점 연결 코드').fill('0011 2233 4455');await page.getByRole('button',{name:'지점 연결',exact:true}).click();
    await page.getByText('가상 검증 지점',{exact:true}).waitFor();await page.getByText('서버 연결됨',{exact:true}).waitFor();
    const store=fs.readFileSync(path.join(root,'AYWA/Sync/connection.bin'));const secret=await electron.evaluate(()=>global.fixture.secret);assert.equal(store.includes(Buffer.from(secret)),false);assert.equal(store.includes(Buffer.from('가상 검증 지점')),false);
    const login=await electron.evaluate(()=>global.fixture.login);assert.equal(login[0].openAtLogin,true);assert.ok(login[0].path.endsWith('AywaSync.exe'));
    await page.locator('input[name="CLASSNOTE_UPLOAD_ID"]').fill('fixture-account');await page.locator('input[name="CLASSNOTE_UPLOAD_PW"]').fill('fixture-private-password');await page.getByRole('button',{name:'계정 설정 저장'}).click();
    await page.getByText('클래스노트: 저장됨 · 메이크에듀: 설정 필요',{exact:true}).waitFor();assert.equal(fs.readFileSync(path.join(root,'AYWA/Sync/connection.bin')).includes(Buffer.from('fixture-private-password')),false);
    const duplicate=spawn(executable,args,{env,windowsHide:true,stdio:'ignore'});const code=await new Promise((resolve,reject)=>{duplicate.once('error',reject);duplicate.once('exit',resolve);setTimeout(()=>{duplicate.kill();reject(new Error('duplicate did not exit'));},10000).unref();});assert.equal(code,0);
    await page.screenshot({path:path.join(root,'settings.png'),fullPage:true});
    await electron.evaluate(()=>{global.fixture.revoked=true;});const reset=await page.evaluate(()=>window.agent.command('reset'));assert.equal(reset.ok,true);assert.equal(reset.state.paired,false);assert.equal(reset.state.credentials.CLASSNOTE_UPLOAD_ID,false);
    const calls=await electron.evaluate(()=>global.fixture.calls);assert.ok(!calls.includes('module-start'));console.log(JSON.stringify({passed:true,encrypted:true,duplicateBlocked:true,revokedConnectionReset:true,operationalWorkers:0,realNetworkRequests:0,evidence:root}));
  }finally{await electron.evaluate(({app})=>app.exit(0)).catch(()=>{});await electron.close().catch(()=>{});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
