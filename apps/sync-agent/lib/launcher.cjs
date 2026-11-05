'use strict';
// 실행기(AywaSync.exe) 바꾸기·넘겨받기(1.0.13).
// 앱 안 업데이트는 본체만 versions/<순번>에 받는다 — 설치 폴더의 실행기는 설치 파일을 다시 돌리기 전엔 그대로였다.
// 그래서 1.0.7에서 고친 '업데이트 세 번째에 새 버전이 안 뜸'이 현장 PC(10/15 설치본)에는 들어가지 못했다(11/3 1.0.11 적용 뒤 앱이 안 켜짐).
// 이제 본체가 자기 버전 폴더의 실행기로 설치 폴더 실행기를 바꾸고, 옛 실행기가 띄운 본체는 업데이트 때 새 실행기로 넘긴다.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const LAUNCHER='AywaSync.exe',VERSION_FILE='aywa-launcher.json',INSTALL_FILE='aywa-install.json';
// 판 표시가 없는 실행기 = 1.0.11까지의 옛 실행기.
function launcherVersion(dir){
  try{const v=JSON.parse(fs.readFileSync(path.join(dir,VERSION_FILE),'utf8')).launcher;return Number.isSafeInteger(v)&&v>0?v:1;}catch{return 1;}
}
function sha256(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function sameDir(a,b){return path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();}
function writeJson(file,value){const temp=`${file}.${process.pid}.tmp`;fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
const validSequence=v=>Number.isSafeInteger(v)&&v>0;
// 설치 폴더 본체의 순번 — 설치 파일이 넣은 aywa-install.json(1.0.13~), 없으면 설치 폴더 본체의 build-config.json(app.asar 안 — Electron fs로 읽힌다).
// 0 = 모름. 실행기는 이 값으로 '버전 폴더가 없는 순번'을 설치 폴더 본체로 착각하지 않는다.
function installedSequenceOf(installDir,read=fs.readFileSync){
  try{const v=JSON.parse(read(path.join(installDir,INSTALL_FILE),'utf8')).sequence;if(validSequence(v))return v;}catch{}
  try{const v=JSON.parse(read(path.join(installDir,'resources','app.asar','build-config.json'),'utf8')).sequence;if(validSequence(v))return v;}catch{}
  return 0;
}
// 옛 설치 폴더(표식 없음)에 설치본 순번을 적어 둔다 — 새 실행기가 옛 실행기처럼 '모르는 순번 = 실패'로 판단하게.
function ensureInstallSequence(installDir,read=fs.readFileSync){
  const file=path.join(installDir,INSTALL_FILE);if(fs.existsSync(file))return installedSequenceOf(installDir,read);
  const sequence=installedSequenceOf(installDir,read);if(sequence)writeJson(file,{sequence});return sequence;
}
// 지난번에 비켜 둔 실행기·덜 쓴 복사본. 새 실행기가 본체를 한 번 띄워 증명한 뒤에만 지운다(본체가 판단 — main.cjs).
function cleanupOldLaunchers(dir){
  let removed=0;try{for(const name of fs.readdirSync(dir))if(/^AywaSync\.exe\.(?:old-\d+|new)$/.test(name)){try{fs.rmSync(path.join(dir,name),{force:true});removed++;}catch{}}}catch{}return removed;
}
// src를 dst 자리에 넣는다. ① 서명 목록의 해시와 같아야 하고 ② 그 자리에서 한 번 돌려(자가 시험) 통과해야 한다.
// Windows는 실행 중인 exe를 덮어쓰거나 지우지는 못해도 이름은 바꿀 수 있다 — 지금 도는 옛 실행기는 비켜 두고 넣는다(지우지 않는다).
async function place(src,dst,{expectedSha=null,selftest,version}){
  const hash=sha256(src);if(expectedSha&&hash!==expectedSha)throw Object.assign(new Error('launcher_not_signed'),{code:'NOT_SIGNED'});
  const temp=`${dst}.new`;fs.copyFileSync(src,temp);
  try{
    if(sha256(temp)!==hash)throw Object.assign(new Error('launcher_copy_mismatch'),{code:'COPY_MISMATCH'});
    if(!await selftest(temp,version))throw Object.assign(new Error('launcher_selftest_failed'),{code:'SELFTEST'});
  }catch(error){fs.rmSync(temp,{force:true});throw error;}
  let old=null;if(fs.existsSync(dst)){old=`${dst}.old-${Date.now()}`;fs.renameSync(dst,old);}
  try{fs.renameSync(temp,dst);}catch(error){if(old)try{fs.renameSync(old,dst);}catch{}fs.rmSync(temp,{force:true});throw error;}
}
// 설치 폴더 실행기를 이 버전 것으로. 더 높은 판만 넣는다(되돌린 옛 버전이 새 실행기를 낮추지 않게).
async function refreshInstalledLauncher({installDir,ownDir,expectedSha=null,selftest,read=fs.readFileSync}){
  if(!installDir||!ownDir||sameDir(installDir,ownDir))return{status:'same'};
  const own=launcherVersion(ownDir),current=launcherVersion(installDir);
  if(own<=current)return{status:'current',version:current};
  const src=path.join(ownDir,LAUNCHER),dst=path.join(installDir,LAUNCHER);
  if(!fs.existsSync(src)||!fs.existsSync(dst))return{status:'missing'};
  ensureInstallSequence(installDir,read);
  await place(src,dst,{expectedSha,selftest,version:own});writeJson(path.join(installDir,VERSION_FILE),{launcher:own});
  return{status:'updated',version:own};
}
// 옛 실행기가 띄운 본체가 업데이트를 적용할 때 넘겨받을 새 실행기. 설치 폴더가 이미 새 판이면 그것,
// 아니면(설치 폴더에 쓸 수 없었다) 지점 폴더 launcher\에 둔 복사본에 설치 폴더·설치본 순번을 알려 준다. 버전 폴더의 실행기는 쓰지 않는다 —
// 그 폴더는 다음 업데이트가 지우는데, 실행 중인 파일이 있으면 지우기가 실패해 업데이트가 멈춘다.
async function handoverTarget({installDir,ownDir,dataRoot,expectedSha=null,selftest,read=fs.readFileSync}){
  if(!installDir||!ownDir||!dataRoot)return null;
  const installed=path.join(installDir,LAUNCHER);
  if(launcherVersion(installDir)>=2&&fs.existsSync(installed))return{exe:installed,args:['--handover','--hidden']};
  const src=path.join(ownDir,LAUNCHER),version=launcherVersion(ownDir);if(version<2||!fs.existsSync(src))return null;
  const dir=path.join(dataRoot,'launcher'),dst=path.join(dir,LAUNCHER);fs.mkdirSync(dir,{recursive:true});
  if(!(launcherVersion(dir)===version&&fs.existsSync(dst)&&sha256(dst)===sha256(src))){cleanupOldLaunchers(dir);await place(src,dst,{expectedSha,selftest,version});writeJson(path.join(dir,VERSION_FILE),{launcher:version});}
  const sequence=installedSequenceOf(installDir,read);
  return{exe:dst,args:['--handover','--hidden',`--install-dir=${path.resolve(installDir)}`,...(sequence?[`--install-sequence=${sequence}`]:[])]};
}
// 넘겨받는 실행기에는 이 본체의 실행 정보(건강 파일·순번·시험 실행)를 물려주지 않는다 — 새 실행기가 새로 정한다.
function handoverEnv(env){const out={};for(const [key,value] of Object.entries(env))if(!/^(?:AYWA_|ELECTRON_)/i.test(key))out[key]=value;return out;}
// 서명된 파일 목록이 말하는 이 버전의 실행기 해시(버전 폴더의 release.json). 없으면 넣지 않는다.
function signedLauncherSha(ownDir,verify){const m=verify(JSON.parse(fs.readFileSync(path.join(ownDir,'release.json'),'utf8')));const entry=m.files.find(f=>f.path===LAUNCHER);if(!entry)throw Object.assign(new Error('launcher_not_listed'),{code:'NOT_LISTED'});return entry.sha256;}
module.exports={LAUNCHER,VERSION_FILE,INSTALL_FILE,launcherVersion,installedSequenceOf,ensureInstallSequence,cleanupOldLaunchers,refreshInstalledLauncher,handoverTarget,handoverEnv,signedLauncherSha};
