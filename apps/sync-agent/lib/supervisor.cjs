const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {createBroker}=require('./broker.cjs');
const {createWorkerLog}=require('./worker-log.cjs');
const CREDENTIAL_KEYS=['CLASSNOTE_UPLOAD_ID','CLASSNOTE_UPLOAD_PW','CLASSNOTE_AUTHOR_NAME','MAKEEDU_ID','MAKEEDU_PW','GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_SERVICE_ACCOUNT_KEY','GOOGLE_DRIVE_GCLOUD_ACCOUNT','GOOGLE_DRIVE_GCLOUD_PATH','CLASSNOTE_VIDEO_DRIVE_FOLDER_ID','CLASSNOTE_VIDEO_TEACHER_FOLDERS'];
// Preserve existing behavior switches during migration, including intentionally disabled automation.
// ClassNote 자동 해제·명부 퇴원처리 스위치(2026-11-03) — 이 목록에 없으면 워커에 안 넘어간다. 값은 계정 저장소에 있을 때만 넘어가는데
//   지금 화면은 ID/PW만 저장한다 — PC에서 켜고 끌 토글은 아직 없다(퇴원처리를 기본 켜짐으로 바꾸기 전에 먼저 만든다).
//   CLASSNOTE_OFFBOARD = 명부 퇴원처리(퇴소) — 기본 꺼짐(관찰 모드) · 'on'일 때만 실제로 내린다.
CREDENTIAL_KEYS.push('CLASSNOTE_OFFBOARD','CLASSNOTE_OFFBOARD_DAILY_LIMIT','CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA');
CREDENTIAL_KEYS.push('CLASSNOTE_BOARD_AUTO_SYNC','CLASSNOTE_BOARD_AUTO_RELEASE','CLASSNOTE_LEGACY_SHARE_BASES','CLASSNOTE_VIDEO_COMPRESS','CLASSNOTE_VIDEO_DRIVE_ACCOUNT_MIN_FREE_GB','CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB','CLASSNOTE_LOG_KEEP_DAYS','CLASSNOTE_LOG_MAX_MB','MAKEEDU_STORAGE_STATE','MAKEEDU_CONC','MAKEEDU_CONSULT_MAX','MAKEEDU_INVOICE_FROM','MAKEEDU_INVOICE_MONTHS','MAKEEDU_INVOICE_TO','MAKEEDU_PROSPECT_MAX_AGE_DAYS','MAKEEDU_VOID_STALE','MAKEEDU_ALLOW_BULK_VOID');
const TASK=/^[A-Za-z]{1,32}$/;
function setTask(record,task){if(record.task!==task){record.task=task;record.taskSince=Date.now();}}
// 단계 알림 — 'cycle'(새 주기)·'idle'(쉬는 중)은 비우고, 이름이 실려 오면 그 일로. 이름 없는 'stage'는 그대로 둔다.
function noteTask(record,body){const task=typeof body?.task==='string'&&TASK.test(body.task)?body.task:null;if(task)setTask(record,task);else if(['cycle','idle'].includes(body?.phase))setTask(record,null);}
// 예약 작업(메이크에듀 정기 동기화·로그인 점검)은 시작·끝 알림으로 안다.
function noteJob(record,body){const task=typeof body?.detail?.task==='string'&&TASK.test(body.detail.task)?body.detail.task:null;if(!task)return;if(body.kind==='job_started')setTask(record,task);else if(['job_succeeded','job_failed'].includes(body.kind)&&record.task===task)setTask(record,null);}
class Supervisor {
  constructor({resources,root,api,identity,lease,event,base,executable=process.execPath}){Object.assign(this,{resources,root,api,identity,lease,event,base,executable});this.stateRoot=path.join(root,'tenants',identity.tenantId,'state');this.modules=new Map();this.retry=new Map();this.draining=false;}
  status(module){const r=this.modules.get(module);return r?r.drain?'draining':'running':(this.retry.get(module)?.until>Date.now()?'error':'off');}
  get busy(){return this.modules.size>0;}
  /** 모듈마다 지금 하는 일(워커가 단계마다 알린 TASK_LABELS 키 · 없으면 null)과 그 일을 시작한 시각 — 업데이트가 기다리는 작업 표시(1.0.7). */
  activity(){return [...this.modules].map(([module,r])=>({module,task:r.task??null,since:r.taskSince??r.started,draining:!!(r.drain||this.draining)}));}
  healthy(config,local,credentials){return ['classnote','makeedu'].every(name=>{
    const keys=name==='classnote'?['CLASSNOTE_UPLOAD_ID','CLASSNOTE_UPLOAD_PW']:['MAKEEDU_ID','MAKEEDU_PW'];
    return !config.cutoverReady||!config.enabled||local.paused||!config[`${name}Enabled`]||!local[`${name}Enabled`]||keys.some(k=>!credentials[k])||this.modules.get(name)?.cycleSeen===true;
  });}
  async reconcile(config,local,credentials){
    for(const module of ['classnote','makeedu']){
      const permitted=!this.draining&&this.lease.held&&config.cutoverReady&&config.enabled&&!local.paused&&config[`${module}Enabled`]&&local[`${module}Enabled`];
      const current=this.modules.get(module);
      if(current&&!permitted)current.drain=true;
      if(permitted&&!current&&(this.retry.get(module)?.until??0)<=Date.now()){
        const keys=module==='classnote'?['CLASSNOTE_UPLOAD_ID','CLASSNOTE_UPLOAD_PW']:['MAKEEDU_ID','MAKEEDU_PW'];
        if(keys.some(k=>!credentials[k])){this.retry.set(module,{until:Date.now()+60000,failures:0});this.event('credentials_needed',module,'warning');continue;}
        await this.start(module,credentials);
      }
    }
  }
  async start(module,credentials){
    this.lease.assert();const record={drain:false,process:null,broker:null,started:Date.now()};this.modules.set(module,record);
    try {
      await this.api.call('module-start',this.lease.envelope(module));
      record.broker=await createBroker({module,lease:this.lease,api:this.api,isDraining:()=>record.drain||this.draining,
        onCycle:body=>{record.cycleSeen=true;noteTask(record,body);},onEvent:body=>{noteJob(record,body);if(['job_started','job_succeeded','job_failed'].includes(body.kind))this.event(body.kind,module==='classnote'&&body.module==='video'?'video':module,body.kind==='job_failed'?'error':'info',body.detail??{});}});
      const out=path.join(this.stateRoot,module);fs.mkdirSync(out,{recursive:true});
      // Start from a minimal OS environment: never inherit development/server secrets.
      const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','COMSPEC','PATH','PATHEXT'])if(process.env[key])env[key]=process.env[key];
      for(const key of CREDENTIAL_KEYS)if(credentials[key])env[key]=credentials[key];
      Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',SYNC_AGENT_MODE:'1',SYNC_AGENT_BROKER_PORT:String(record.broker.port),SYNC_AGENT_BROKER_TOKEN:record.broker.token,
        DATABASE_URL:'agent://registered',CLASSNOTE_TENANT_ID:this.identity.tenantId,CLASSNOTE_VIDEO_TENANT_ID:this.identity.tenantId,MAKEEDU_TENANT_ID:this.identity.tenantId,
        CLASSNOTE_SHARE_BASE:this.base,CLASSNOTE_SCREENSHOT_BASE:this.base,CLASSNOTE_INTERNAL_SECRET:`agent:${this.identity.deviceId}.${this.identity.secret}:${this.lease.instanceId}:${this.lease.generation}`,
        CLASSNOTE_OUT:path.join(this.stateRoot,'classnote'),CLASSNOTE_VIDEO_OUT:path.join(this.stateRoot,'classnote','videos'),MAKEEDU_OUT:path.join(this.stateRoot,'makeedu'),MAKEEDU_SESSION_FILE:path.join(this.stateRoot,'makeedu','session.json'),
        CLASSNOTE_PUBLISH_MODE:'post',PLAYWRIGHT_BROWSERS_PATH:path.join(this.resources,'browsers'),
        CLASSNOTE_FFMPEG_PATH:path.join(this.resources,'ffmpeg','ffmpeg.exe'),CLASSNOTE_FFPROBE_PATH:path.join(this.resources,'ffmpeg','ffprobe.exe')});
      const runtime=path.join(this.resources,'runtime');const entry=module==='classnote'?'scripts/_classnote/watch-classnote-queue.mjs':'scripts/_makeedu/watch-sync-requests.cjs';
      const logs=createWorkerLog(path.join(this.root,'tenants',this.identity.tenantId,'log'),{secrets:[...Object.values(credentials),this.identity.secret,record.broker.token],onSafeLog:({logCode,level})=>this.event('worker_log',module,level,{logCode})});
      const stdout=logs.sink(module),stderr=logs.sink(module);
      const child=spawn(path.join(this.resources,'WorkerHost.exe'),[this.executable,path.join(runtime,entry),...(module==='classnote'?['--post']:[])],{cwd:runtime,env,windowsHide:true,stdio:['pipe','pipe','pipe']});record.process=child;
      child.stdout.on('data',stdout.write);child.stderr.on('data',stderr.write);child.once('close',()=>{stdout.end();stderr.end();});
      // Only fixed summaries cross the network. Raw lines stay in the local tenant log.
      const done=async(failed)=>{if(this.modules.get(module)!==record||record.stopping)return;record.stopping=true;record.broker.close();
        try{await this.api.call('module-stop',{instanceId:this.lease.instanceId,generation:this.lease.generation,module});}catch{this.lease.lose();}
        this.modules.delete(module);
        if(failed&&!record.drain&&!this.draining){const failures=(this.retry.get(module)?.failures??0)+1;this.retry.set(module,{failures,until:Date.now()+Math.min(300000,5000*2**Math.min(6,failures))});this.event('module_failed',module,'error');}
        else{this.retry.delete(module);this.event('module_stopped',module,'info');}};
      child.once('error',()=>done(true));child.once('exit',code=>done(code!==0));this.event('module_started',module,'info');
    }catch(e){record.broker?.close();this.modules.delete(module);throw e;}
  }
  drain(){this.draining=true;for(const r of this.modules.values())r.drain=true;}
  kill(){this.draining=true;for(const r of this.modules.values()){r.drain=true;r.process?.stdin.destroy();r.broker?.close();}}
}
module.exports={Supervisor,CREDENTIAL_KEYS,noteTask,noteJob};
