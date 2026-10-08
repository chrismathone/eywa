const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const {createBroker}=require('./broker.cjs');
const {createWorkerLog}=require('./worker-log.cjs');
const CREDENTIAL_KEYS=['CLASSNOTE_UPLOAD_ID','CLASSNOTE_UPLOAD_PW','CLASSNOTE_AUTHOR_NAME','MAKEEDU_ID','MAKEEDU_PW','GOOGLE_DRIVE_CLIENT_ID','GOOGLE_DRIVE_CLIENT_SECRET','GOOGLE_DRIVE_REFRESH_TOKEN','GOOGLE_SERVICE_ACCOUNT_KEY','GOOGLE_DRIVE_GCLOUD_ACCOUNT','GOOGLE_DRIVE_GCLOUD_PATH','CLASSNOTE_VIDEO_DRIVE_FOLDER_ID','CLASSNOTE_VIDEO_TEACHER_FOLDERS'];
// Preserve existing behavior switches during migration, including intentionally disabled automation.
CREDENTIAL_KEYS.push('CLASSNOTE_BOARD_AUTO_SYNC','CLASSNOTE_BOARD_AUTO_RELEASE','CLASSNOTE_LEGACY_SHARE_BASES','CLASSNOTE_VIDEO_COMPRESS','CLASSNOTE_VIDEO_DRIVE_ACCOUNT_MIN_FREE_GB','CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB','CLASSNOTE_LOG_KEEP_DAYS','CLASSNOTE_LOG_MAX_MB','MAKEEDU_STORAGE_STATE','MAKEEDU_CONC','MAKEEDU_CONSULT_MAX','MAKEEDU_INVOICE_FROM','MAKEEDU_INVOICE_MONTHS','MAKEEDU_INVOICE_TO','MAKEEDU_PROSPECT_MAX_AGE_DAYS','MAKEEDU_VOID_STALE','MAKEEDU_ALLOW_BULK_VOID');
class Supervisor {
  constructor({resources,root,api,identity,lease,event,base,executable=process.execPath}){Object.assign(this,{resources,root,api,identity,lease,event,base,executable});this.stateRoot=path.join(root,'tenants',identity.tenantId,'state');this.modules=new Map();this.retry=new Map();this.draining=false;}
  status(module){const r=this.modules.get(module);return r?r.drain?'draining':'running':(this.retry.get(module)?.until>Date.now()?'error':'off');}
  get busy(){return this.modules.size>0;}
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
        onCycle:()=>{record.cycleSeen=true;},onEvent:body=>{if(['job_started','job_succeeded','job_failed'].includes(body.kind))this.event(body.kind,module==='classnote'&&body.module==='video'?'video':module,body.kind==='job_failed'?'error':'info',body.detail??{});}});
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
module.exports={Supervisor,CREDENTIAL_KEYS};
