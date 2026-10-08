// Real Electron UI/controller; all network, work and installer actions are fixtures.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const {_electron}=require('../build/runtime/node_modules/playwright');
async function main(){
 const root=fs.mkdtempSync(path.resolve(__dirname,'../../../work/update-controller-')),env={...process.env,LOCALAPPDATA:root,APPDATA:path.join(root,'Roaming')};
 for(const key of ['ELECTRON_RUN_AS_NODE','DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NODE_OPTIONS'])delete env[key];
 const packaged=process.argv.includes('--packaged');
 console.log(JSON.stringify({stage:'launch',packaged}));
 const electron=await _electron.launch({executablePath:path.resolve(__dirname,packaged?'../dist/win-unpacked/AywaSyncRuntime.exe':'../node_modules/electron/dist/electron.exe'),args:packaged?[]:[path.resolve(__dirname,'..')],env,timeout:30000});
 console.log(JSON.stringify({stage:'fixture'}));
 try{
  await electron.evaluate(({app,Notification})=>{
   const load=process.mainModule.require.bind(process.mainModule),path=load('node:path'),base=app.getAppPath(),{Updater}=load(path.join(base,'lib/update.cjs')),{Supervisor}=load(path.join(base,'lib/supervisor.cjs')),{UpdatePlan}=load(path.join(base,'lib/update-plan.cjs'));
   global.fixture={calls:[],activations:0,busy:false,now:Date.now(),enabled:true,notifications:0};
   // Advance only the appointment clock; keep Electron, IPC, leases and unlock expiry on real time.
   const request=UpdatePlan.prototype.request;UpdatePlan.prototype.request=function(...args){this.now=()=>global.fixture.now;return request.apply(this,args);};
   app.setLoginItemSettings=()=>{};Notification.prototype.show=function(){global.fixture.notifications++;};
   Updater.prototype.check=async function(){this.ready={sequence:3,version:'1.0.2',expiresAt:'2099-01-01T00:00:00Z'};this.state='ready';};
   Updater.prototype.activate=function(){global.fixture.activations++;throw new Error('fixture: installation deliberately unavailable');};
   Object.defineProperty(Supervisor.prototype,'busy',{get(){return global.fixture.busy;}});
   global.fetch=async(url,init)=>{
    if(!String(url).startsWith('https://www.aywa.co.kr/api/sync-agent/'))throw new Error('external request blocked');
    const action=String(url).split('/').pop(),body=JSON.parse(init.body);global.fixture.calls.push(action);let value;
    const tenantId='bd4a636a-5356-483f-bf1c-b615067a7426',config={protocol:1,tenantId,tenantName:'업데이트 가상 검증 지점',enabled:false,classnoteEnabled:false,makeeduEnabled:false,updatesEnabled:global.fixture.enabled,cutoverReady:true,revision:1};
    if(action==='pair')value={deviceId:body.deviceId,tenantId,tenantName:config.tenantName,protocol:1};else if(action==='acquire')value={generation:'1',remainingMs:90000};
    else if(action==='heartbeat')value={remainingMs:90000,config};else if(action==='events')value={accepted:body.events.map(e=>e.id)};else if(action==='release')value={ok:true};else throw new Error('unexpected '+action);
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
   };
  });
  console.log(JSON.stringify({stage:'pair'}));
  const page=await electron.firstWindow({timeout:15000});page.setDefaultTimeout(15000);await page.getByLabel('지점 연결 코드').fill('001122334455');await page.getByRole('button',{name:'지점 연결',exact:true}).click();
  await page.getByText('다운로드 완료 · 적용 방법 선택',{exact:true}).waitFor();assert.equal(await electron.evaluate(()=>global.fixture.activations),0);
  const state=async()=> (await page.evaluate(()=>window.agent.command('state'))).state;
  const tick=async()=>{const s=await state();await page.evaluate(local=>window.agent.command('settings',local),s.local);};
  const waitPlan=async value=>{await page.waitForFunction(async expected=>(await window.agent.command('state')).state.updateInfo.plan?.state===expected,value);};
  console.log(JSON.stringify({stage:'schedule'}));
  const when=Date.now()+180000;const whenLocal=new Date(when);const pad=n=>String(n).padStart(2,'0');
  await page.getByLabel('예약 날짜·시간 (이 PC 기준)').fill(`${whenLocal.getFullYear()}-${pad(whenLocal.getMonth()+1)}-${pad(whenLocal.getDate())}T${pad(whenLocal.getHours())}:${pad(whenLocal.getMinutes())}`);
  await page.getByRole('button',{name:'시간 지정',exact:true}).click();await waitPlan('scheduled');
  assert.equal(await electron.evaluate(()=>global.fixture.activations),0);const at=(await state()).updateInfo.plan.at;
  await page.screenshot({path:path.join(root,'scheduled.png'),fullPage:true});
  await page.getByRole('button',{name:'예약·적용 대기 취소'}).click();assert.equal((await state()).updateInfo.plan,null);
  const scheduled=await page.evaluate(at=>window.agent.command('update-schedule',{sequence:3,at}),at);assert.equal(scheduled.ok,true);
  console.log(JSON.stringify({stage:'drain'}));
  await electron.evaluate(at=>{global.fixture.busy=true;global.fixture.now=Date.parse(at)+1000;},at);await tick();await waitPlan('waiting');
  assert.equal(await electron.evaluate(()=>global.fixture.activations),0);const waiting=await state();console.log(JSON.stringify({stage:'cancel-drain',unlocked:waiting.unlocked,online:waiting.online,update:waiting.update,info:waiting.updateInfo}));await page.getByRole('button',{name:'예약·적용 대기 취소'}).click();assert.equal((await state()).updateInfo.plan,null);
  await page.getByRole('button',{name:'지금 업데이트',exact:true}).click();await waitPlan('waiting');assert.equal(await electron.evaluate(()=>global.fixture.activations),0);
  await electron.evaluate(()=>{global.fixture.busy=false;});await tick();await waitPlan('failed');assert.equal(await electron.evaluate(()=>global.fixture.activations),1);
  await tick();assert.equal(await electron.evaluate(()=>global.fixture.activations),1);
  const stale=await page.evaluate(()=>window.agent.command('update-now',{sequence:2}));assert.equal(stale.ok,false);
  await electron.evaluate(()=>{global.fixture.enabled=false;});await tick();await page.waitForFunction(async()=>!(await window.agent.command('state')).state.configuration.updatesEnabled);
  assert.equal((await page.evaluate(()=>window.agent.command('update-now',{sequence:3}))).ok,false);
  const result=await electron.evaluate(()=>global.fixture);assert.ok(!result.calls.includes('module-start'));
  console.log(JSON.stringify({passed:true,packaged,downloadDoesNotApply:true,appointmentPersisted:true,cancelWhileBusy:true,immediateWaitsForWork:true,failedApplyNotRetried:true,staleChoiceRejected:true,serverDisableRespected:true,operationalWorkers:0,realNetworkRequests:0,evidence:root}));
 }catch(error){console.error('Controller fixture failed:',error.message);throw error;}
 finally{await Promise.race([electron.evaluate(({app})=>app.exit(0)).catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);electron.process().kill();await Promise.race([electron.close().catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
