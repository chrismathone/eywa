const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,dialog,powerMonitor,safeStorage,Notification,shell}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {randomUUID,randomBytes}=require('node:crypto');
const {AgentApi}=require('./lib/api.cjs');const {DeviceLease}=require('./lib/lease.cjs');const {Supervisor,CREDENTIAL_KEYS}=require('./lib/supervisor.cjs');
const {atomicWrite,secretStore,eventQueue}=require('./lib/storage.cjs');const {Updater,verifyManifest}=require('./lib/update.cjs');
const {UpdatePlan}=require('./lib/update-plan.cjs');
const {createWorkerLog}=require('./lib/worker-log.cjs');
const {humanLoginEnv,humanLoginMessage,readLoginBlock,startHumanLogin,passwordPrefill,credentialsSaved}=require('./lib/makeedu-login.cjs');
const {launcherVersion,refreshInstalledLauncher,handoverTarget,handoverEnv,cleanupOldLaunchers,signedLauncherSha}=require('./lib/launcher.cjs');const {spawn,execFile}=require('node:child_process');
const {inspectLegacy,disableLegacyTasks,readLegacySettings,copyLegacyState}=require('./lib/legacy.cjs');
const {LocalSettingsInput,StoredLocalSettingsInput,DEFAULT_LOCAL_SETTINGS,EventInput,EVENT_LABELS,LOG_CODE_LABELS,UPDATE_ERROR_LABELS,TASK_LABELS}=require('./lib/protocol.cjs');
const build=require('./build-config.json');
// Resolve from the OS profile, independent of executable/version directory.
const dataRoot=path.resolve(process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local'),'AYWA','Sync');
fs.mkdirSync(path.join(dataRoot,'electron'),{recursive:true});
app.setPath('userData',path.join(dataRoot,'electron'));
// 창만 띄워 달라는 실행(--show — 실행기가 두 번째 실행을 넘길 때)은 주인이 되지 않는다. 주인 본체가 아직 안 떴을 때 이 실행이 잠금을 쥐면
// 실행기가 띄운 본체가 밀려나 새 버전 시작이 실패로 잡힌다. 실행기가 띄운 본체가 잠금을 못 잡으면 43 — 1.0.13 실행기는 실패로 세지 않고 다시 띄운다.
if(!app.requestSingleInstanceLock()){if(process.env.AYWA_HEALTH_FILE&&!process.argv.includes('--show'))app.exit(43);else app.quit();}else if(process.argv.includes('--show')){app.releaseSingleInstanceLock();app.quit();}else{void app.whenReady().then(start).catch(()=>{dialog.showErrorBox('AYWA 연동','앱을 시작하지 못했습니다. 설치 파일을 다시 실행해 주세요.');app.exit(1);});}
let window,tray,store,events,connection=null,local={...DEFAULT_LOCAL_SETTINGS},lease,api,supervisor,updater,updatePlan,configuration=null;
let message='',unlockedUntil=0,looping=false,quitting=false,closing=false,applying=false,suspended=false,nextConnect=0,revoked=false;
let notifiedUpdate=0;
// 메이크에듀 '다시 로그인'(사람 로그인 창, 2026-11-06) — 열려 있는 동안의 실행 · 마지막 결과(화면 문구).
let humanLogin=null,humanLoginResult=null,humanLoginNote=null; // humanLoginNote = 창을 열 때 비밀번호를 채웠나(filled·locked·blocked)
// 업데이트 적용 단계(화면 가운데 진행 표시, 1.0.7): 'drain'(진행 중인 작업 마무리) → 'switch'(새 버전으로 바꾸기). 새 버전은 justUpdated로 이어 받는다.
let applyStep=null,justUpdated=null;
// 실행기가 이 버전의 건강 확인을 받아 갔는가 — 그 전에 끝나면 실행기가 시작 실패로 읽어 되돌린다(업데이트 적용은 그 뒤에만).
// 건강 파일이 사라진 걸 본 뒤에도 3초 더 — 옛 실행기는 건강 파일을 지운 다음에 launch.json(시험 실행 끝)을 쓰므로, 곧바로 적용하면 그 쓰기가 적용을 덮는다.
let healthReported=false,healthGoneAt=0;
function launcherReady(){
  const file=process.env.AYWA_HEALTH_FILE;if(!file)return true;if(!healthReported)return false;
  if(fs.existsSync(path.resolve(file))){healthGoneAt=0;return false;}if(!healthGoneAt)healthGoneAt=Date.now();return Date.now()-healthGoneAt>=3000;
}
const afterUpdateFile=path.join(dataRoot,'after-update.json');
function dropAfterUpdate(){try{fs.rmSync(afterUpdateFile,{force:true});}catch{}}
const uiFile=path.join(__dirname,'ui','index.html');
function event(kind,module='app',level='info',detail={}){const row={id:randomUUID(),at:new Date().toISOString(),kind,module,level,detail};if(EventInput.safeParse(row).success){events?.add(row);try{createWorkerLog(path.join(dataRoot,...(connection?.tenantId?['tenants',connection.tenantId]:[]),'log')).append('app',`${module} · ${detail.logCode?LOG_CODE_LABELS[detail.logCode]:EVENT_LABELS[kind]??'실행 기록'}${detail.version?' · '+detail.version:''}${detail.updateError?' · '+UPDATE_ERROR_LABELS[detail.updateError]:''}`);}catch{}}}
// 앱 자원 폴더(runtime·browsers·WorkerHost) — 설치본은 resources, 개발 실행은 build.
function resourcesRoot(){return app.isPackaged?process.resourcesPath:path.join(__dirname,'build');}
function tenantStateRoot(){return connection?.tenantId?path.join(dataRoot,'tenants',connection.tenantId,'state'):null;}
function makeeduLoginState(){const root=tenantStateRoot();return{running:!!humanLogin,passwordNote:humanLogin?humanLoginNote:null,result:humanLoginResult,blocked:root?readLoginBlock(root):null};}
function snapshot(){return{version:build.version,tenantName:connection?.tenantName??'',paired:!!connection?.tenantId,revoked,online:!!lease?.held,unlocked:Date.now()<unlockedUntil,local,
  configuration,modules:{classnote:supervisor?.status('classnote')??'off',makeedu:supervisor?.status('makeedu')??'off'},update:updater?.state??'idle',message,
  updateInfo:{ready:updater?.ready??null,plan:updatePlan?.plan??null,progress:updater?.progress??null,pending:!!updater?.pending,failure:updater?.failure?UPDATE_ERROR_LABELS[updater.failure]:null,checkedAt:updater?.checkedAt??null,draining:applying&&!closing,closing,applyStep,justUpdated},
  activity:(supervisor?.activity()??[]).map(a=>({module:a.module,task:a.task,label:a.task&&Object.hasOwn(TASK_LABELS,a.task)?TASK_LABELS[a.task]:null,since:a.since,draining:a.draining})),
  credentials:Object.fromEntries(CREDENTIAL_KEYS.map(k=>[k,!!connection?.credentials?.[k]])),makeeduLogin:makeeduLoginState(),events:events?.peek().slice(-12)??[]};}
function broadcast(){if(window&&!window.isDestroyed())window.webContents.send('state',snapshot());}
function show(){if(!window)return;if(window.isMinimized())window.restore();window.show();window.focus();}
function requireUnlocked(){if(Date.now()>=unlockedUntil)throw new Error('웹의 연동 PC 탭에서 관리 코드를 발급받아 입력해 주세요.');}
function applyLoginSetting(){app.setLoginItemSettings({openAtLogin:local.autoStart,path:path.join(process.env.AYWA_INSTALL_DIR||path.dirname(process.execPath),'AywaSync.exe'),args:['--hidden']});}
// 지금 도는 버전의 파일 폴더 = 실행 파일이 있는 곳(versions/<순번> 또는 설치 폴더) — 같은 파일은 받지 않고 여기서 복사한다(1.0.7).
function bootApi(){api=new AgentApi(build.apiOrigin,connection);updater=new Updater({root:dataRoot,api,publicKey:build.publicKey,sequence:build.sequence,event,currentRoot:app.isPackaged?path.dirname(process.execPath):null});}
let loggedDelta=null;
function appLog(text){try{createWorkerLog(path.join(dataRoot,...(connection?.tenantId?['tenants',connection.tenantId]:[]),'log')).append('app',text);}catch{}}
async function checkUpdates(){
  const current=updater;await current?.check();if(current!==updater)return;
  // 바뀐 파일만 받았는지·왜 전체를 받았는지 — 현장 진단용(서버로는 안 보낸다).
  if(current?.delta&&current.delta!==loggedDelta){loggedDelta=current.delta;appLog(current.delta.fallback?`update · 바뀐 파일만 받기 실패(${current.delta.fallback}) → 전체 받기`:`update · 같은 파일 ${current.delta.reused}개 복사 · 바뀐 파일 ${current.delta.fetched}개만 받음`);}
  if(current?.ready&&notifiedUpdate!==current.ready.sequence){
    notifiedUpdate=current.ready.sequence;tray?.setToolTip(`AYWA 연동 · v${current.ready.version} 업데이트 선택 대기`);
    try{if(Notification.isSupported()){const notice=new Notification({title:'AYWA 연동 업데이트 준비 완료',body:`v${current.ready.version} · 지금 업데이트하거나 날짜·시간을 지정해 주세요.`});notice.on('click',show);notice.show();}}catch{}
  }
  broadcast();
}
async function start(){
  Menu.setApplicationMenu(null);
  fs.mkdirSync(dataRoot,{recursive:true});store=secretStore(dataRoot,safeStorage);
  try{connection=store.read();}catch{message='저장된 연결을 열지 못했습니다. 같은 Windows 계정으로 실행했는지 확인해 주세요.';}
  events=eventQueue(path.join(dataRoot,'events',connection?.deviceId??'unpaired'));
  try{local=StoredLocalSettingsInput.parse(JSON.parse(fs.readFileSync(path.join(dataRoot,'settings.json'),'utf8')));}catch{}
  updatePlan=new UpdatePlan({root:dataRoot,sequence:build.sequence});
  // 업데이트로 다시 켜졌는가 — 직전 버전이 남긴 표식(시작 프로그램의 launch.json과 따로 둔다: 그쪽은 시작 프로그램이 다시 써 넣는다).
  let afterUpdate=null;try{afterUpdate=JSON.parse(fs.readFileSync(afterUpdateFile,'utf8'));}catch{}
  if(afterUpdate&&!(Date.now()-Date.parse(afterUpdate.at)<3600000)){afterUpdate=null;dropAfterUpdate();}
  if(!process.env.AYWA_HEALTH_FILE)dropAfterUpdate();
  if(afterUpdate?.sequence===build.sequence){justUpdated={version:build.version,at:new Date().toISOString()};message=`v${build.version}로 업데이트했습니다.`;setTimeout(()=>{justUpdated=null;broadcast();},20000);}
  else if(afterUpdate)message='새 버전을 시작하지 못해 이전 버전으로 되돌렸습니다. 설정과 작업은 그대로입니다.';
  window=new BrowserWindow({width:840,height:850,minWidth:620,minHeight:600,show:false,backgroundColor:'#f5f7fb',title:'AYWA 연동',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.webContents.on('render-process-gone',()=>{supervisor?.kill();lease?.lose();message='화면을 다시 열고 있습니다.';void window.loadFile(uiFile);});
  window.on('close',e=>{if(!quitting||applyStep==='switch'){e.preventDefault();window.hide();}});registerIpc();await window.loadFile(uiFile);
  const pixels=Buffer.alloc(24*24*4);for(let y=0;y<24;y++)for(let x=0;x<24;x++){const i=(y*24+x)*4;pixels[i]=30;pixels[i+1]=80;pixels[i+2]=160;pixels[i+3]=255;if((y>5&&y<19)&&(x===6+Math.floor((18-y)/3)||x===17-Math.floor((18-y)/3)||y===14&&x>7&&x<17))pixels.fill(255,i,i+4);}
  tray=new Tray(nativeImage.createFromBitmap(pixels,{width:24,height:24}));tray.setToolTip('AYWA 연동');tray.on('double-click',show);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'연동 앱 열기',click:show},{label:'작업을 마치고 종료',click:()=>void shutdown()}]));
  app.on('second-instance',show);app.on('activate',show);app.on('before-quit',e=>{if(applyStep==='switch'){e.preventDefault();return;}if(!quitting){e.preventDefault();void shutdown();}});
  powerMonitor.on('suspend',()=>{suspended=true;interruptUpdate();lease?.lose();supervisor?.kill();});powerMonitor.on('resume',()=>{suspended=false;interruptUpdate();nextConnect=Date.now()+10000;});
  event('app_started');if(connection?.tenantId)bootApi();
  // 화면을 보던 중 업데이트했으면 숨김 시작(--hidden)이어도 창을 다시 띄운다.
  if(!connection?.tenantId||afterUpdate?.show||(!local.startMinimized&&!process.argv.includes('--hidden')))show();
  setInterval(()=>{if(lease&&!lease.held&&!lease.lost)lease.lose();broadcast();},1000);
  setInterval(()=>void tick(),20000);void tick();
  // Successful startup means the UI, protected storage and supervisor initialized; network can be offline.
  if(process.env.AYWA_HEALTH_FILE)setTimeout(()=>{
    const health=setInterval(()=>{
      if(process.env.AYWA_TRIAL==='1'&&connection?.tenantId&&(!lease?.held||!configuration||!supervisor?.healthy(configuration,local,connection.credentials??{})))return;
      clearInterval(health);const file=path.resolve(process.env.AYWA_HEALTH_FILE);if(path.dirname(file)===dataRoot&&path.basename(file).startsWith('health-')){atomicWrite(file,'ready');healthReported=true;}
      dropAfterUpdate(); // 이 버전이 자리 잡았다 — 업데이트 표식은 여기서 끝
      setTimeout(refreshLauncher,5000);
    },1000);
  },15000);
  try{const journal=JSON.parse(fs.readFileSync(path.join(dataRoot,'launch.json'),'utf8'));if(journal.rollback){event('update_rollback','update','warning');delete journal.rollback;atomicWrite(path.join(dataRoot,'launch.json'),JSON.stringify(journal));}}catch{}
}
async function tick(){
  if(looping||quitting||suspended||!connection?.tenantId||Date.now()<nextConnect)return;looping=true;
  try{
    if(!lease?.held){
      if(supervisor?.busy)return;
      lease=new DeviceLease(api,{instanceId:randomUUID(),version:build.version,onLost:()=>{interruptUpdate();supervisor?.kill();event('lease_lost','app','warning');nextConnect=Date.now()+15000;}});
      if(!await lease.acquire())throw new Error('lease_lost');
      supervisor=new Supervisor({resources:resourcesRoot(),root:dataRoot,api,identity:connection,lease,event,base:build.apiOrigin});
      event('connection_restored');
    }
    const status={state:local.paused?'paused':supervisor?.busy?'working':'ready',classnote:supervisor?.status('classnote')??'off',makeedu:supervisor?.status('makeedu')??'off',update:updater?.state??'idle',busy:!!supervisor?.busy};
    configuration=await lease.renew(status);if(!configuration)return;
    const applyUpdate=!closing&&launcherReady()&&updatePlan.shouldApply({ready:updater.ready,enabled:configuration.updatesEnabled});
    if(applying&&!closing&&!applyUpdate){applying=false;supervisor.draining=false;applyStep=null;}
    if(applyUpdate){applying=true;applyStep='drain';supervisor.drain();}
    if(!applying)await supervisor.reconcile(configuration,local,connection.credentials??{});
    const queued=events.peek();if(queued.length){const result=await api.call('events',{events:queued});events.ack(result.accepted);}
    if(!closing&&configuration.updatesEnabled&&local.autoDownload)void checkUpdates();
    // Re-evaluate after awaited calls: a user may cancel/reschedule while events upload.
    if(!closing&&applyUpdate&&updatePlan.shouldApply({ready:updater.ready,enabled:configuration.updatesEnabled})&&!supervisor.busy){
      try{lease.assert();updatePlan.applying();updater.activate();}catch{updatePlan.failed();applying=false;applyStep=null;supervisor.draining=false;message='업데이트를 적용하지 못했습니다. 새 버전을 다시 확인하고 적용 방법을 선택해 주세요.';event('update_failed','update','warning');return;}
      event('update_applied','update','info',{version:updater.ready.version});quitting=true;applyStep='switch';
      try{atomicWrite(afterUpdateFile,JSON.stringify({sequence:updater.ready.sequence,version:updater.ready.version,show:!!window?.isVisible(),at:new Date().toISOString()}));}catch{}
      try{broadcast();}catch{}await lease.release().catch(()=>{});
      // '새 버전으로 바꾸기' 단계를 잠깐 보여 준 뒤 끝낸다(곧바로 끝내면 화면이 말없이 사라진다).
      await new Promise(r=>setTimeout(r,1500));
      await exitForUpdate();
    }
  }catch(e){interruptUpdate();if(e.code==='unauthorized'){revoked=true;lease?.lose();supervisor?.kill();}message=e.code==='device_busy'?'같은 지점의 다른 실행이 종료되기를 기다리고 있습니다.':e.code==='unauthorized'?'PC 연결이 해제되었습니다. 웹에서 새 연결 코드를 발급해 주세요.':'서버 연결을 확인하고 있습니다. 연결되면 자동으로 다시 시작합니다.';}
  finally{looping=false;broadcast();}
}
// 이 버전 폴더의 실행기 해시는 서명된 파일 목록에서 — 시작 때 실행기가 확인한 파일이지만 넣기 직전에 한 번 더.
function launcherSha(ownDir){return signedLauncherSha(ownDir,envelope=>verifyManifest(envelope,build.publicKey,{now:0}));}
// 넣을 실행기를 그 자리에서 한 번 돌려 본다(--selftest — 실행기는 판 숫자만 적고 끝난다). 이 PC에서 안 도는 실행기를 진입점에 넣지 않는다.
function launcherSelftest(exe,version){
  const file=path.join(dataRoot,`selftest-${randomUUID()}`);
  return new Promise(resolve=>execFile(exe,[`--selftest=${file}`],{timeout:20000,windowsHide:true},()=>{let ok=false;try{ok=fs.readFileSync(file,'utf8')===`launcher:${version}`;}catch{}dropMarker(file);resolve(ok);}));
}
// 설치 폴더 실행기를 이 버전 것으로 — 앱 안 업데이트는 본체만 받아서, 1.0.7에서 고친 실행기가 설치 폴더엔 들어가지 못했다(1.0.13).
// 비켜 둔 옛 실행기는 새 실행기가 본체를 한 번 띄워 증명한 뒤(AYWA_LAUNCHER ≥ 설치 폴더 판)에만 지운다 — 그 전엔 손으로 되돌릴 마지막 실행기다.
async function refreshLauncher(){
  const installDir=process.env.AYWA_INSTALL_DIR;if(!app.isPackaged||!installDir)return;
  const ownDir=path.dirname(process.execPath);
  try{
    const result=await refreshInstalledLauncher({installDir,ownDir,expectedSha:sameDir(installDir,ownDir)?null:launcherSha(ownDir),selftest:launcherSelftest});
    if(result.status==='updated')event('worker_log','update','info',{logCode:'launcher_updated'});
    else if(Number(process.env.AYWA_LAUNCHER)>=launcherVersion(installDir))cleanupOldLaunchers(installDir);
  }catch(error){appLog(`launcher · 설치 폴더 실행기 교체 실패(${String(error.code??error.message??'').slice(0,40)})`);event('worker_log','update','warning',{logCode:'launcher_update_failed'});}
}
function sameDir(a,b){return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
// 표식 파일 지우기는 실패해도 넘어간다(백신이 잠깐 잡고 있어도) — 여기서 던지면 'switch' 상태로 앱이 멈춘다.
function dropMarker(file){try{fs.rmSync(file,{force:true});}catch{}}
// 새 버전 띄우기. 실행기 없이 직접 켰으면 Electron이 다시 켜고, 1.0.13 실행기(AYWA_LAUNCHER≥2)는 42를 받아 새 버전을 띄운다.
// 옛 실행기(1.0.7 전 판)는 42를 세어 세 번째에 아무것도 띄우지 않으므로 — 새 실행기를 먼저 띄워(앞 실행기의 잠금이 풀리길 기다린다)
// '기다리는 중' 표식을 받은 뒤에만 0으로 끝낸다. 옛 실행기는 건강 확인을 마친 본체가 0으로 끝나면 그냥 끝난다. 넘기지 못하면 예전처럼 42.
async function exitForUpdate(){
  const installDir=process.env.AYWA_INSTALL_DIR;
  if(!installDir){app.relaunch({execPath:path.join(path.dirname(process.execPath),'AywaSync.exe'),args:['--hidden']});app.exit(42);return;}
  if(Number(process.env.AYWA_LAUNCHER)>=2||!app.isPackaged){app.exit(42);return;}
  // 감시: 넘겨받기가 어디서든 멈추면 90초 뒤 예전처럼 42로 끝낸다(리스는 이미 반납했다 — 끝나지 않으면 앱이 멈춘 채로 남는다).
  setTimeout(()=>app.exit(42),90000).unref?.();
  let child=null;const ready=path.join(dataRoot,`handover-${randomUUID()}`);
  try{
    const ownDir=path.dirname(process.execPath);
    const target=await handoverTarget({installDir,ownDir,dataRoot,expectedSha:sameDir(installDir,ownDir)?null:launcherSha(ownDir),selftest:launcherSelftest});if(!target)throw new Error('no_launcher');
    await new Promise((resolve,reject)=>{
      child=spawn(target.exe,[...target.args,`--handover-ready=${ready}`],{detached:true,stdio:'ignore',cwd:path.dirname(target.exe),env:handoverEnv(process.env)});
      const timer=setTimeout(()=>reject(new Error('spawn_timeout')),10000);
      child.once('spawn',()=>{clearTimeout(timer);resolve();});child.once('error',error=>{clearTimeout(timer);reject(error);});
    });
    for(const end=Date.now()+20000;!fs.existsSync(ready)&&Date.now()<end;)await new Promise(r=>setTimeout(r,200));
    if(!fs.existsSync(ready))throw new Error('handover_not_ready');
    dropMarker(ready);child.unref();
    event('worker_log','update','info',{logCode:'launcher_handover'});app.exit(0);
  }catch(error){
    try{child?.kill();}catch{}dropMarker(ready);
    appLog(`launcher · 새 실행기로 넘기지 못함(${String(error.code??error.message??'').slice(0,40)}) · 지금 실행기에 맡김`);app.exit(42);
  }
}
function interruptUpdate(){updatePlan?.interrupt();if(!closing){applying=false;if(!quitting)applyStep=null;if(supervisor)supervisor.draining=false;}}
function requireUpdateAllowed(){if(closing||quitting)throw new Error('앱이 종료 중입니다. 다시 실행한 뒤 선택해 주세요.');if(!lease?.held||!configuration?.updatesEnabled)throw new Error('서버 연결과 웹의 업데이트 허용 설정을 확인해 주세요.');}
async function shutdown(){
  if(quitting||closing)return;closing=true;applying=true;applyStep=null;supervisor?.drain();humanLogin?.stop();message='진행 중인 작업을 마친 뒤 종료합니다.';broadcast();
  const check=setInterval(async()=>{if(supervisor?.busy)return;clearInterval(check);event('app_stopped');await lease?.release().catch(()=>{});quitting=true;app.quit();},500);
}
function registerIpc(){
  ipcMain.handle('command',async(e,action,input)=>{
    if(e.sender!==window.webContents||e.senderFrame!==window.webContents.mainFrame)throw new Error('unauthorized');
    try{
      switch(action){
        case 'state':return{ok:true,state:snapshot()};
        case 'logs':{const dir=path.join(dataRoot,...(connection?.tenantId?['tenants',connection.tenantId]:[]),'log');fs.mkdirSync(dir,{recursive:true});const error=await shell.openPath(dir);if(error)throw Error('로그 폴더를 열지 못했습니다.');return{ok:true};}
        case 'makeedu-login':{
          // 메이크에듀 '다시 로그인'(2026-11-06) — makeedu가 자동 로그인에 사람 확인을 요구한다. 보이는 창에서 사람이 로그인 버튼·사람 확인을 누르면
          // 그 세션을 모듈이 그대로 쓴다. 창은 바로 열고, 결과는 상태(makeeduLogin)와 안내 문구로 알린다(최대 5분 · 그동안 다른 버튼도 쓸 수 있다).
          if(!connection?.tenantId)throw new Error('지점을 먼저 연결해 주세요.');
          if(closing||quitting)throw new Error('앱이 종료 중입니다.');
          if(humanLogin)throw new Error('makeedu 로그인 창이 이미 열려 있습니다. 그 창에서 로그인을 마쳐 주세요.');
          const credentials=connection.credentials??{},resources=resourcesRoot();
          const logs=createWorkerLog(path.join(dataRoot,'tenants',connection.tenantId,'log'),{secrets:Object.values(credentials)}),sink=logs.sink('makeedu');
          try{logs.append('app','makeedu · 다시 로그인 창 열기');}catch{}
          humanLoginResult=null;
          // 비밀번호 미리 채우기 — PC 설정이 열려 있고(개발자 도구로 칸 값을 읽을 수 있어 계정 설정과 같은 잠금) 비밀번호·계정 계열 멈춤이 없을 때만
          // (틀린 것으로 확인된 비밀번호를 채워 사람이 그대로 누르면 시도 횟수가 준다 — 리뷰 2026-11-06). 아이디는 늘 채운다.
          const prefill=passwordPrefill({unlocked:Date.now()<unlockedUntil,block:readLoginBlock(tenantStateRoot())});
          humanLoginNote=prefill.note;
          humanLogin=startHumanLogin({resources,executable:process.execPath,onOutput:sink.write,
            env:humanLoginEnv({resources,stateRoot:tenantStateRoot(),credentials,includePassword:prefill.include}),
            onDone:result=>{sink.end();humanLogin=null;humanLoginNote=null;humanLoginResult={ok:result.ok,code:result.code,message:humanLoginMessage(result),at:new Date().toISOString()};message=humanLoginResult.message;
              try{logs.append('app',`makeedu · 다시 로그인 ${result.ok?'성공':'실패'}(${result.code}${result.headless?` · headless 재사용 ${result.headless}`:''})`);}catch{}show();broadcast();}});
          // 창은 보이지만(WorkerHost는 콘솔만 숨긴다 — 2026-11-06 실측 visible) Windows가 뒤에서 띄운 창을 앞으로 올려 주지 않을 수 있다 — 작업 표시줄 안내.
          message=`makeedu 로그인 창을 열었습니다 — 그 창(안 보이면 작업 표시줄의 Chrome for Testing)에서 ${prefill.include?'':'비밀번호를 직접 입력하고 '}로그인 버튼을 누르고 사람 확인을 마쳐 주세요(5분 안에).`;break;
        }
        case 'pair':{
          if(connection?.tenantId)throw new Error('연결된 PC입니다. 웹에서 기존 연결을 해제해 주세요.');
          const code=String(input?.code??'').replace(/[\s-]/g,'');if(!/^\d{12}$/.test(code))throw new Error('12자리 연결 코드를 입력해 주세요.');
          // Persist before sending: a lost response retries with the exact same device/secret.
          if(!connection)connection={deviceId:randomUUID(),secret:randomBytes(32).toString('base64url'),credentials:{}};store.write(connection);bootApi();
          const paired=await api.call('pair',{code,deviceId:connection.deviceId,secret:connection.secret,name:os.hostname().slice(0,80)},false);
          connection={...connection,...paired};store.write(connection);events=eventQueue(path.join(dataRoot,'events',connection.deviceId));applyLoginSetting();unlockedUntil=Date.now()+15*60000;event('paired');void tick();break;
        }
        case 'unlock':await api.call('unlock',{code:input?.code});unlockedUntil=Date.now()+600000;break;
        case 'settings':{
          requireUnlocked();const parsed=LocalSettingsInput.parse(input);local=parsed;atomicWrite(path.join(dataRoot,'settings.json'),JSON.stringify(local));
          applyLoginSetting();
          if(local.paused)supervisor?.drain();else if(supervisor&&!applying)supervisor.draining=false;void tick();break;
        }
        case 'credentials':{
          requireUnlocked();if(!connection?.tenantId)throw new Error('지점을 먼저 연결해 주세요.');
          if(!input||Object.keys(input).some(k=>!CREDENTIAL_KEYS.includes(k))||Object.values(input).some(v=>typeof v!=='string'||v.length>30000))throw new Error('계정 값을 확인해 주세요.');
          connection.credentials={...connection.credentials,...input};store.write(connection);supervisor?.drain();message='현재 작업이 끝난 뒤 새 계정 설정으로 다시 시작합니다.';
          // 메이크에듀 **비밀번호**를 저장하면(같은 값이어도) 비밀번호·계정 계열 자동 로그인 멈춤을 푼다 · 사람 확인 계열은 그대로 · 아이디만 바꾼
          // 저장은 풀지 않는다(자격이 바뀌면 워커의 지문 비교가 이미 한 번 다시 시도하게 한다) — 2026-11-06 리뷰.
          {let cleared=null;try{cleared=credentialsSaved(tenantStateRoot(),input);}catch{}
            if(cleared){appLog(`makeedu · 비밀번호 다시 저장 — 비밀번호·계정 확인 멈춤(${cleared}) 해제`);message='현재 작업이 끝난 뒤 새 계정 설정으로 다시 시작합니다. 메이크에듀 자동 로그인 멈춤도 풀었습니다 — 저장 세션이 끊겨 있으면 다음 실행이 저장한 비밀번호로 한 번 로그인합니다.';}}
          const reset=setInterval(()=>{if(!supervisor?.busy){clearInterval(reset);if(supervisor&&!applying)supervisor.draining=false;void tick();}},1000);break;
        }
        case 'import':{
          requireUnlocked();if(supervisor?.busy)throw new Error('연동을 일시 중지하고 현재 작업이 끝난 뒤 가져와 주세요.');
          const choice=await dialog.showOpenDialog(window,{title:'기존 워커 폴더 선택',properties:['openDirectory']});if(choice.canceled)return{ok:true,state:snapshot()};
          const legacy=readLegacySettings(choice.filePaths[0]);if(legacy.tenantIds.some(id=>id!==connection.tenantId))throw new Error('다른 지점의 설정이 포함되어 있습니다.');
          const state=await inspectLegacy();if(state.running)throw new Error('기존 워커가 실행 중입니다. 작업을 마치고 종료한 뒤 가져와 주세요.');
          await copyLegacyState(legacy.folders,path.join(dataRoot,'tenants',connection.tenantId));
          if(legacy.session){const destination=path.join(dataRoot,'tenants',connection.tenantId,'state','makeedu','session.json');fs.mkdirSync(path.dirname(destination),{recursive:true});if(!fs.existsSync(destination))fs.copyFileSync(legacy.session,destination,fs.constants.COPYFILE_EXCL);}
          connection.credentials={...connection.credentials,...legacy.credentials};store.write(connection);message='기존 계정 설정과 작업 기록을 가져왔습니다.';break;
        }
        case 'legacy':requireUnlocked();return{ok:true,legacy:await inspectLegacy(),state:snapshot()};
        case 'cutover':{
          requireUnlocked();if(!lease?.held)throw new Error('서버 연결을 기다려 주세요.');
          await disableLegacyTasks();const old=await inspectLegacy();if(old.running)throw new Error('기존 워커가 아직 실행 중입니다. 작업을 마친 뒤 종료해 주세요. 예약 실행은 해제했습니다.');
          await api.call('cutover',{instanceId:lease.instanceId,generation:lease.generation});message='기존 워커 확인을 마쳤습니다. 켜 둔 연동을 시작합니다.';void tick();break;
        }
        case 'update':requireUpdateAllowed();updater.nextCheck=0;void checkUpdates();break;
        case 'update-now':requireUpdateAllowed();updatePlan.request(updater.ready,{sequence:input?.sequence});message='현재 작업을 마치고 선택한 버전을 적용합니다.';void tick();break;
        case 'update-schedule':requireUpdateAllowed();if(typeof input?.at!=='string')throw new Error('예약 날짜와 시간을 지정해 주세요.');updatePlan.request(updater.ready,{sequence:input?.sequence,at:input.at});if(!closing){applying=false;applyStep=null;supervisor.draining=false;}message='이 버전의 업데이트 시간을 예약했습니다.';void tick();break;
        case 'update-cancel':if(closing||quitting)throw new Error('앱이 종료 중입니다.');updatePlan.cancel();applying=false;applyStep=null;if(supervisor)supervisor.draining=false;message='업데이트 예약을 취소했습니다. 새 적용 방법을 선택할 때까지 기다립니다.';void tick();break;
        case 'reset':{
          if(supervisor?.busy)throw new Error('이전 실행이 종료되기를 기다려 주세요.');
          let confirmed=false;try{await api.call('configuration');}catch(e){if(e.code==='unauthorized')confirmed=true;else throw e;}
          if(!confirmed)throw new Error('웹에서 현재 PC의 연결을 먼저 해제해 주세요.');
          store.clear();updatePlan.cancel();connection=null;configuration=null;api=null;lease=null;supervisor=null;updater=null;events=eventQueue(path.join(dataRoot,'events','unpaired'));revoked=false;unlockedUntil=0;message='새 지점 연결 코드를 입력해 주세요.';break;
        }
        case 'quit':void shutdown();break;
        default:throw new Error('지원하지 않는 작업입니다.');
      }
      broadcast();return{ok:true,state:snapshot()};
    }catch(error){const labels={invalid_code:'코드가 만료되었거나 올바르지 않습니다.',device_exists:'이미 연결된 PC가 있습니다.',legacy_busy:'이전 워커의 종료 확인을 기다리고 있습니다. 3분 뒤 다시 시도해 주세요.',slow_down:'잠시 후 다시 시도해 주세요.'};return{ok:false,error:labels[error.code]||(error.code?'요청을 처리하지 못했습니다. 서버 연결을 확인해 주세요.':error.name==='ZodError'?'설정 값을 확인해 주세요.':error.message)};}
  });
}
