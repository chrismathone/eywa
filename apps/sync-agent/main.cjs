const {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,dialog,powerMonitor,safeStorage}=require('electron');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {randomUUID,randomBytes}=require('node:crypto');
const {AgentApi}=require('./lib/api.cjs');const {DeviceLease}=require('./lib/lease.cjs');const {Supervisor,CREDENTIAL_KEYS}=require('./lib/supervisor.cjs');
const {atomicWrite,secretStore,eventQueue}=require('./lib/storage.cjs');const {Updater}=require('./lib/update.cjs');
const {inspectLegacy,disableLegacyTasks,readLegacySettings,copyLegacyState}=require('./lib/legacy.cjs');
const {LocalSettingsInput,DEFAULT_LOCAL_SETTINGS,EventInput}=require('./lib/protocol.cjs');
const build=require('./build-config.json');
// Resolve from the OS profile, independent of executable/version directory.
const dataRoot=path.resolve(process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local'),'AYWA','Sync');
fs.mkdirSync(path.join(dataRoot,'electron'),{recursive:true});
app.setPath('userData',path.join(dataRoot,'electron'));
if(!app.requestSingleInstanceLock()){app.quit();}else{void app.whenReady().then(start).catch(()=>{dialog.showErrorBox('AYWA 연동','앱을 시작하지 못했습니다. 설치 파일을 다시 실행해 주세요.');app.exit(1);});}
let window,tray,store,events,connection=null,local={...DEFAULT_LOCAL_SETTINGS},lease,api,supervisor,updater,configuration=null;
let message='',unlockedUntil=0,looping=false,quitting=false,closing=false,applying=false,suspended=false,nextConnect=0,revoked=false;
const uiFile=path.join(__dirname,'ui','index.html');
function event(kind,module='app',level='info',detail={}){const row={id:randomUUID(),at:new Date().toISOString(),kind,module,level,detail};if(EventInput.safeParse(row).success)events?.add(row);}
function snapshot(){return{version:build.version,tenantName:connection?.tenantName??'',paired:!!connection?.tenantId,revoked,online:!!lease?.held,unlocked:Date.now()<unlockedUntil,local,
  configuration,modules:{classnote:supervisor?.status('classnote')??'off',makeedu:supervisor?.status('makeedu')??'off'},update:updater?.state??'idle',message,
  credentials:Object.fromEntries(CREDENTIAL_KEYS.map(k=>[k,!!connection?.credentials?.[k]])),events:events?.peek().slice(-12)??[]};}
function broadcast(){if(window&&!window.isDestroyed())window.webContents.send('state',snapshot());}
function show(){if(!window)return;if(window.isMinimized())window.restore();window.show();window.focus();}
function requireUnlocked(){if(Date.now()>=unlockedUntil)throw new Error('웹의 연동 PC 탭에서 관리 코드를 발급받아 입력해 주세요.');}
function applyLoginSetting(){app.setLoginItemSettings({openAtLogin:local.autoStart,path:path.join(process.env.AYWA_INSTALL_DIR||path.dirname(process.execPath),'AywaSync.exe'),args:['--hidden']});}
function bootApi(){api=new AgentApi(build.apiOrigin,connection);updater=new Updater({root:dataRoot,api,publicKey:build.publicKey,sequence:build.sequence,event});}
async function start(){
  fs.mkdirSync(dataRoot,{recursive:true});store=secretStore(dataRoot,safeStorage);
  try{connection=store.read();}catch{message='저장된 연결을 열지 못했습니다. 같은 Windows 계정으로 실행했는지 확인해 주세요.';}
  events=eventQueue(path.join(dataRoot,'events',connection?.deviceId??'unpaired'));
  try{local=LocalSettingsInput.parse(JSON.parse(fs.readFileSync(path.join(dataRoot,'settings.json'),'utf8')));}catch{}
  window=new BrowserWindow({width:840,height:850,minWidth:620,minHeight:600,show:false,backgroundColor:'#f5f7fb',title:'AYWA 연동',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  window.webContents.on('render-process-gone',()=>{supervisor?.kill();lease?.lose();message='화면을 다시 열고 있습니다.';void window.loadFile(uiFile);});
  window.on('close',e=>{if(!quitting){e.preventDefault();window.hide();}});registerIpc();await window.loadFile(uiFile);
  const pixels=Buffer.alloc(24*24*4);for(let y=0;y<24;y++)for(let x=0;x<24;x++){const i=(y*24+x)*4;pixels[i]=30;pixels[i+1]=80;pixels[i+2]=160;pixels[i+3]=255;if((y>5&&y<19)&&(x===6+Math.floor((18-y)/3)||x===17-Math.floor((18-y)/3)||y===14&&x>7&&x<17))pixels.fill(255,i,i+4);}
  tray=new Tray(nativeImage.createFromBitmap(pixels,{width:24,height:24}));tray.setToolTip('AYWA 연동');tray.on('double-click',show);
  tray.setContextMenu(Menu.buildFromTemplate([{label:'연동 앱 열기',click:show},{label:'작업을 마치고 종료',click:()=>void shutdown()}]));
  app.on('second-instance',show);app.on('activate',show);app.on('before-quit',e=>{if(!quitting){e.preventDefault();void shutdown();}});
  powerMonitor.on('suspend',()=>{suspended=true;lease?.lose();supervisor?.kill();});powerMonitor.on('resume',()=>{suspended=false;nextConnect=Date.now()+10000;});
  event('app_started');if(connection?.tenantId)bootApi();
  if(!connection?.tenantId||(!local.startMinimized&&!process.argv.includes('--hidden')))show();
  setInterval(()=>{if(lease&&!lease.held&&!lease.lost)lease.lose();broadcast();},1000);
  setInterval(()=>void tick(),20000);void tick();
  // Successful startup means the UI, protected storage and supervisor initialized; network can be offline.
  if(process.env.AYWA_HEALTH_FILE)setTimeout(()=>{
    const health=setInterval(()=>{
      if(process.env.AYWA_TRIAL==='1'&&connection?.tenantId&&(!lease?.held||!configuration||!supervisor?.healthy(configuration,local,connection.credentials??{})))return;
      clearInterval(health);const file=path.resolve(process.env.AYWA_HEALTH_FILE);if(path.dirname(file)===dataRoot&&path.basename(file).startsWith('health-'))atomicWrite(file,'ready');
    },1000);
  },15000);
  try{const journal=JSON.parse(fs.readFileSync(path.join(dataRoot,'launch.json'),'utf8'));if(journal.rollback){event('update_rollback','update','warning');delete journal.rollback;atomicWrite(path.join(dataRoot,'launch.json'),JSON.stringify(journal));}}catch{}
}
async function tick(){
  if(looping||quitting||suspended||!connection?.tenantId||Date.now()<nextConnect)return;looping=true;
  try{
    if(!lease?.held){
      if(supervisor?.busy)return;
      lease=new DeviceLease(api,{instanceId:randomUUID(),version:build.version,onLost:()=>{supervisor?.kill();event('lease_lost','app','warning');nextConnect=Date.now()+15000;}});
      if(!await lease.acquire())throw new Error('lease_lost');
      supervisor=new Supervisor({resources:app.isPackaged?process.resourcesPath:path.join(__dirname,'build'),root:dataRoot,api,identity:connection,lease,event,base:build.apiOrigin});
      event('connection_restored');
    }
    const status={state:local.paused?'paused':supervisor?.busy?'working':'ready',classnote:supervisor?.status('classnote')??'off',makeedu:supervisor?.status('makeedu')??'off',update:updater?.state??'idle',busy:!!supervisor?.busy};
    configuration=await lease.renew(status);if(!configuration)return;
    if(applying&&!closing&&(!configuration.updatesEnabled||!local.autoUpdate||!inUpdateWindow())){applying=false;supervisor.draining=false;}
    if(!applying)await supervisor.reconcile(configuration,local,connection.credentials??{});
    const queued=events.peek();if(queued.length){const result=await api.call('events',{events:queued});events.ack(result.accepted);}
    if(configuration.updatesEnabled&&local.autoUpdate){void updater.check();if(updater.ready&&inUpdateWindow()) {applying=true;supervisor.drain();if(!supervisor.busy){updater.activate();await lease.release().catch(()=>{});quitting=true;if(!process.env.AYWA_INSTALL_DIR)app.relaunch({execPath:path.join(path.dirname(process.execPath),'AywaSync.exe'),args:['--hidden']});app.exit(42);}}}
  }catch(e){if(e.code==='unauthorized'){revoked=true;lease?.lose();supervisor?.kill();}message=e.code==='device_busy'?'같은 지점의 다른 실행이 종료되기를 기다리고 있습니다.':e.code==='unauthorized'?'PC 연결이 해제되었습니다. 웹에서 새 연결 코드를 발급해 주세요.':'서버 연결을 확인하고 있습니다. 연결되면 자동으로 다시 시작합니다.';}
  finally{looping=false;broadcast();}
}
function inUpdateWindow(){const h=new Date().getHours(),a=local.updateStartHour,b=local.updateEndHour;return a===b||(a<b?h>=a&&h<b:h>=a||h<b);}
async function shutdown(){
  if(quitting||closing)return;closing=true;applying=true;supervisor?.drain();message='진행 중인 작업을 마친 뒤 종료합니다.';broadcast();
  const check=setInterval(async()=>{if(supervisor?.busy)return;clearInterval(check);event('app_stopped');await lease?.release().catch(()=>{});quitting=true;app.quit();},500);
}
function registerIpc(){
  ipcMain.handle('command',async(e,action,input)=>{
    if(e.sender!==window.webContents||e.senderFrame!==window.webContents.mainFrame)throw new Error('unauthorized');
    try{
      switch(action){
        case 'state':return{ok:true,state:snapshot()};
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
        case 'update':requireUnlocked();updater.nextCheck=0;void updater.check();break;
        case 'reset':{
          if(supervisor?.busy)throw new Error('이전 실행이 종료되기를 기다려 주세요.');
          let confirmed=false;try{await api.call('configuration');}catch(e){if(e.code==='unauthorized')confirmed=true;else throw e;}
          if(!confirmed)throw new Error('웹에서 현재 PC의 연결을 먼저 해제해 주세요.');
          store.clear();connection=null;configuration=null;api=null;lease=null;supervisor=null;updater=null;events=eventQueue(path.join(dataRoot,'events','unpaired'));revoked=false;unlockedUntil=0;message='새 지점 연결 코드를 입력해 주세요.';break;
        }
        case 'quit':void shutdown();break;
        default:throw new Error('지원하지 않는 작업입니다.');
      }
      broadcast();return{ok:true,state:snapshot()};
    }catch(error){const labels={invalid_code:'코드가 만료되었거나 올바르지 않습니다.',device_exists:'이미 연결된 PC가 있습니다.',legacy_busy:'이전 워커의 종료 확인을 기다리고 있습니다. 3분 뒤 다시 시도해 주세요.',slow_down:'잠시 후 다시 시도해 주세요.'};return{ok:false,error:labels[error.code]||(error.code?'요청을 처리하지 못했습니다. 서버 연결을 확인해 주세요.':error.name==='ZodError'?'설정 값을 확인해 주세요.':error.message)};}
  });
}
