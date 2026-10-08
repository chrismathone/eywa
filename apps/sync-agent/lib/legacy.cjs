const fs=require('node:fs');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify,parseEnv}=require('node:util');
const exec=promisify(execFile);
const {CREDENTIAL_KEYS}=require('./supervisor.cjs');
const TASKS=['eywa-classnote-worker','eywa-makeedu-sync','eywa-makeedu-sync-watcher','eywa-makeedu-health'];
const ps=async script=>{const {stdout}=await exec('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});return stdout.trim();};
async function inspectLegacy(){
  const script=`$ErrorActionPreference='Stop'; $names=@(${TASKS.map(x=>`'${x}'`).join(',')}); $tasks=@(Get-ScheduledTask | Where-Object { $names -contains $_.TaskName } | Select-Object TaskName,State); $processes=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|powershell|pwsh)\\.exe$' -and $_.CommandLine -match '(watch-classnote-queue|watch-sync-requests|sync-all\\.cjs|process-classnote-queue|run-watch-requests|run-classnote)' } | Select-Object ProcessId); @{tasks=$tasks;running=$processes.Count} | ConvertTo-Json -Compress`;
  return JSON.parse(await ps(script));
}
async function disableLegacyTasks(){
  await ps(`$ErrorActionPreference='Stop'; $names=@(${TASKS.map(x=>`'${x}'`).join(',')}); Get-ScheduledTask | Where-Object {$names -contains $_.TaskName} | Disable-ScheduledTask | Out-Null`);
}
function readLegacySettings(repo){
  const full=path.resolve(repo),file=path.join(full,'.env.local');
  if(!fs.existsSync(file))throw new Error('선택한 폴더에서 기존 설정을 찾지 못했습니다.');
  if(fs.statSync(file).size>1024*1024)throw new Error('설정 파일 크기를 확인해 주세요.');
  const raw=parseEnv(fs.readFileSync(file,'utf8')),credentials={};
  for(const key of CREDENTIAL_KEYS)if(raw[key])credentials[key]=raw[key];
  const classnote=[raw.CLASSNOTE_OUT,'D:/tmp/classnote',path.join(full,'scripts/_classnote/_logs')].filter(Boolean).map(p=>path.resolve(full,p)).find(p=>fs.existsSync(p));
  const makeedu=path.resolve(full,raw.MAKEEDU_OUT||'.makeedu-tmp');
  const video=raw.CLASSNOTE_VIDEO_OUT?path.resolve(full,raw.CLASSNOTE_VIDEO_OUT):null;
  const session=raw.MAKEEDU_SESSION_FILE?path.resolve(full,raw.MAKEEDU_SESSION_FILE):null;
  return {credentials,folders:{classnote,makeedu:fs.existsSync(makeedu)?makeedu:null,video:video&&fs.existsSync(video)?video:null},session:session&&fs.existsSync(session)?session:null,tenantIds:[raw.CLASSNOTE_TENANT_ID,raw.MAKEEDU_TENANT_ID,raw.CLASSNOTE_VIDEO_TENANT_ID].filter(Boolean)};
}
async function copyLegacyState(folders,root){
  for(const [module,source]of Object.entries(folders)){
    if(!source)continue;const destination=module==='video'?path.resolve(root,'state','classnote','videos'):path.resolve(root,'state',module),full=path.resolve(source);
    if(destination===full||destination.startsWith(full+path.sep)||full.startsWith(destination+path.sep))throw new Error('기존 폴더와 새 폴더를 분리해 주세요.');
    // Copy without replacement. Existing markers and uploads survive interrupted/retried migrations.
    await fs.promises.cp(full,destination,{recursive:true,force:false,errorOnExist:false,filter:async file=>{if((await fs.promises.lstat(file)).isSymbolicLink())throw new Error('연결된 폴더는 이전할 수 없습니다.');return true;}});
  }
}
module.exports={inspectLegacy,disableLegacyTasks,readLegacySettings,copyLegacyState,TASKS};
