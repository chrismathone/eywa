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
   const load=process.mainModule.require.bind(process.mainModule),path=load('node:path'),base=app.getAppPath(),{Updater}=load(path.join(base,'lib/update.cjs')),{Supervisor}=load(path.join(base,'lib/supervisor.cjs')),{UpdatePlan}=load(path.join(base,'lib/update-plan.cjs')),build=load(path.join(base,'build-config.json'));
   global.fixture={calls:[],activations:0,busy:false,now:Date.now(),enabled:true,notifications:0};
   // Advance only the appointment clock; keep Electron, IPC, leases and unlock expiry on real time.
   const request=UpdatePlan.prototype.request;UpdatePlan.prototype.request=function(...args){this.now=()=>global.fixture.now;return request.apply(this,args);};
   app.setLoginItemSettings=()=>{};Notification.prototype.show=function(){global.fixture.notifications++;};
   Updater.prototype.check=async function(){global.fixture.updater=this;if(this.pending)return;this.ready={sequence:build.sequence+1,version:'99.0.0',expiresAt:'2099-01-01T00:00:00Z'};this.state='ready';};
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
  const page=await electron.firstWindow({timeout:15000});page.setDefaultTimeout(15000);page.on('pageerror',error=>console.error('Renderer:',error.message));await page.getByLabel('지점 연결 코드').fill('001122334455');await page.getByRole('button',{name:'지점 연결',exact:true}).click();
  await page.getByText('다운로드 완료 · 적용 방법 선택',{exact:true}).waitFor();assert.equal(await electron.evaluate(()=>global.fixture.activations),0);
  // Renderer must distinguish the long ZIP extraction from receiving bytes.
  const phase=async(phase,completed,total,extra={})=>electron.evaluate((_electron,{phase,completed,total,extra})=>{const u=global.fixture.updater;u.ready=null;u.state='downloading';u.pending=true;u.progress={phase,completed,total,...extra,version:'99.0.0',updatedAt:new Date().toISOString()};},{phase,completed,total,extra});
  // 복사 퍼센트 = 용량과 파일 수의 평균(원장 2026-11-09 — 큰 파일이 앞에 몰려 '67 / 10,021개 파일 · 0%'가 용량으로는 약 23% · 평균 11%).
  await phase('copying',67,10021,{bytes:348*1024*1024,totalBytes:1521*1024*1024});await page.getByText('그대로 쓸 파일 복사 중',{exact:true}).waitFor();await page.getByText('348.0 / 1,521.0 MB · 67 / 10,021개 파일 · 11%',{exact:true}).waitFor();assert.equal(await page.getByRole('progressbar',{name:'업데이트 준비 진행률'}).getAttribute('value'),'11');
  await phase('downloading',50*1024*1024,100*1024*1024);await page.getByText('50.0 / 100.0 MB · 50%',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'새 버전 확인',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'지금 업데이트',exact:true}).isDisabled(),true);
  await phase('extracting',1250,10000);await page.getByText('압축 해제 · 파일 검증 중',{exact:true}).waitFor();await page.getByText('1,250 / 10,000개 파일 · 12%',{exact:true}).waitFor();assert.equal(await page.getByRole('progressbar',{name:'업데이트 준비 진행률'}).getAttribute('value'),'12');
  await phase('finalizing',10000,10000);await page.getByText('설치 준비 마무리 중',{exact:true}).waitFor();await page.getByText('10,000 / 10,000개 파일 · 100%',{exact:true}).waitFor();await page.screenshot({path:path.join(root,'progress.png'),fullPage:true});
  await electron.evaluate(()=>{const u=global.fixture.updater;u.pending=false;u.progress=null;u.state='error';u.failure='download_timeout';});await page.getByText('파일 수신이 멈추었거나 제한 시간을 넘었습니다. 새 버전 확인으로 다시 시도해 주세요.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'새 버전 확인',exact:true}).isDisabled(),false);
  await electron.evaluate(()=>{const u=global.fixture.updater;u.state='idle';u.failure=null;u.checkedAt=new Date().toISOString();});await page.getByText('현재 최신 버전입니다.',{exact:true}).waitFor();assert.equal(await page.getByText('다운로드가 끝나면 적용 방법을 선택할 수 있습니다.',{exact:true}).count(),0);
  await page.getByRole('button',{name:'새 버전 확인',exact:true}).click();await page.getByText('다운로드 완료 · 적용 방법 선택',{exact:true}).waitFor();
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
  const readySequence=(await state()).updateInfo.ready.sequence;
  const scheduled=await page.evaluate(({at,sequence})=>window.agent.command('update-schedule',{sequence,at}),{sequence:readySequence,at});assert.equal(scheduled.ok,true);
  console.log(JSON.stringify({stage:'drain'}));
  await electron.evaluate((_electron,at)=>{global.fixture.busy=true;global.fixture.now=Date.parse(at)+1000;},at);await tick();await waitPlan('waiting');
  assert.equal(await electron.evaluate(()=>global.fixture.activations),0);const waiting=await state();console.log(JSON.stringify({stage:'cancel-drain',unlocked:waiting.unlocked,online:waiting.online,update:waiting.update,info:waiting.updateInfo}));await page.getByRole('dialog',{name:'업데이트 적용 중'}).waitFor();await page.getByText('진행 중인 작업 마무리',{exact:true}).waitFor();await page.screenshot({path:path.join(root,'applying.png'),fullPage:true});await page.getByRole('button',{name:'적용 취소',exact:true}).click();await page.getByRole('dialog',{name:'업데이트 적용 중'}).waitFor({state:'hidden'});assert.equal((await state()).updateInfo.plan,null);
  await page.getByRole('button',{name:'지금 업데이트',exact:true}).click();await waitPlan('waiting');assert.equal(await electron.evaluate(()=>global.fixture.activations),0);
  await electron.evaluate(()=>{global.fixture.busy=false;});await tick();await waitPlan('failed');assert.equal(await electron.evaluate(()=>global.fixture.activations),1);
  await tick();assert.equal(await electron.evaluate(()=>global.fixture.activations),1);
  const stale=await page.evaluate(sequence=>window.agent.command('update-now',{sequence:sequence-1}),readySequence);assert.equal(stale.ok,false);
  await electron.evaluate(()=>{global.fixture.enabled=false;});await tick();await page.waitForFunction(async()=>!(await window.agent.command('state')).state.configuration.updatesEnabled);
  assert.equal((await page.evaluate(sequence=>window.agent.command('update-now',{sequence}),readySequence)).ok,false);
  await electron.evaluate(()=>{global.fixture.enabled=true;global.fixture.busy=true;});await tick();
  await electron.evaluate(()=>{const realNow=Date.now;Date.now=()=>realNow()+16*60_000;});await page.waitForFunction(async()=>!(await window.agent.command('state')).state.unlocked);
  await page.getByRole('button',{name:'새 버전 확인',exact:true}).click();await page.getByText('다운로드 완료 · 적용 방법 선택',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.agent.command('credentials',{MAKEEDU_ID:'blocked-fixture'}))).ok,false);
  assert.equal((await page.evaluate(async()=>window.agent.command('settings',(await window.agent.command('state')).state.local))).ok,false);
  assert.equal((await page.evaluate(sequence=>window.agent.command('update-now',{sequence}),readySequence)).ok,true);await waitPlan('waiting');
  assert.equal((await page.evaluate(()=>window.agent.command('update-cancel'))).ok,true);assert.equal((await state()).updateInfo.plan,null);
  assert.equal((await page.evaluate(({sequence,at})=>window.agent.command('update-schedule',{sequence,at}),{sequence:readySequence,at:new Date(when+60*60_000).toISOString()})).ok,true);await waitPlan('scheduled');assert.equal((await page.evaluate(()=>window.agent.command('update-cancel'))).ok,true);
  const result=await electron.evaluate(()=>({calls:global.fixture.calls}));assert.ok(!result.calls.includes('module-start'));
  console.log(JSON.stringify({passed:true,packaged,progressStages:true,updateWithoutManagementCode:true,settingsStayLocked:true,downloadDoesNotApply:true,appointmentPersisted:true,cancelWhileBusy:true,immediateWaitsForWork:true,failedApplyNotRetried:true,staleChoiceRejected:true,serverDisableRespected:true,operationalWorkers:0,realNetworkRequests:0,evidence:root}));
 }catch(error){console.error('Controller fixture failed:',error.message);const page=await electron.firstWindow();console.log(JSON.stringify(await page.evaluate(async()=>({state:(await window.agent.command('state')).state.updateInfo,detail:document.getElementById('update-detail')?.textContent,progress:document.getElementById('update-progress-text')?.textContent}))));throw error;}
 finally{await Promise.race([electron.evaluate(({app})=>app.exit(0)).catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);electron.process().kill();await Promise.race([electron.close().catch(()=>{}),new Promise(r=>setTimeout(r,2000))]);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
