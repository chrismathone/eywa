// 메이크에듀 '다시 로그인'(2026-11-06) — makeedu가 자동 로그인에 사람 확인(reCAPTCHA)을 요구한다. 사람이 보이는 창에서 한 번
// 로그인하면 그 세션을 모듈(watch-sync-requests → scrape 등)이 그대로 쓴다. 이 파일은 앱 쪽 실행·결과 문구·멈춤 표시 읽기만 맡는다.
// 창은 runtime의 scripts/_makeedu/human-login.cjs가 띄운다(로그인 버튼·사람 확인은 사람이 누른다 — 자동 클릭·자동 제출 없음).
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const SCRIPT='scripts/_makeedu/human-login.cjs';const RESULT_TAG='AYWA_HUMAN_LOGIN ';
// 멈춤 갈래(2026-11-06 결정 · 리뷰 반영) — human = 사람 확인 계열('makeedu 다시 로그인'으로 풀림) · password = 비밀번호 계열 ·
// account = 계정 계열·모르는 코드. password·account는 사람 로그인으로 풀리지 않고 'PC 설정 → 연동 계정'에서 비밀번호를 저장할 때만 푼다.
// ⚠️ scripts/_makeedu/login-guard.cjs의 HUMAN_BLOCK_CODES·PASSWORD_BLOCK_CODES와 같아야 한다(시험이 둘을 맞춘다).
const HUMAN_BLOCK_CODES=['CAPTCHA_REQUIRED','NO_REJECT'];const PASSWORD_BLOCK_CODES=['NO_LOGIN_CNT','NO_CHK'];
const isHumanBlock=code=>HUMAN_BLOCK_CODES.includes(code);
const blockFamily=code=>isHumanBlock(code)?'human':PASSWORD_BLOCK_CODES.includes(code)?'password':'account';
const safeCode=code=>typeof code==='string'&&/^[A-Za-z_]{1,40}$/.test(code)?code:'UNKNOWN';
// 멈춤 표시 파일을 읽지 못함(내용 깨짐·읽기 오류) — makeedu가 보낸 모르는 응답(UNKNOWN 등)과 구분하는 내부 코드(login-guard.cjs BLOCK_UNREADABLE와 같다).
const BLOCK_UNREADABLE='BLOCK_UNREADABLE';
// supervisor.cjs와 같은 최소 OS 환경 — 개발·서버 비밀을 물려주지 않는다.
const OS_ENV_KEYS=['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PROGRAMDATA','COMSPEC','PATH','PATHEXT'];
/** 모듈(supervisor)과 같은 세션 파일 — <지점>/state/makeedu/session.json. 자동 로그인 멈춤 표시는 같은 폴더의 login-blocked.json(예비 .alt.json). */
function makeeduSessionFile(stateRoot){return path.join(stateRoot,'makeedu','session.json');}
const blockFiles=stateRoot=>[path.join(stateRoot,'makeedu','login-blocked.json'),path.join(stateRoot,'makeedu','login-blocked.alt.json')];
/**
 * 사람 로그인 환경 — 모듈과 같은 세션 파일·브라우저 폴더·아이디. DB·중계(broker)·다른 연동 계정은 넘기지 않는다.
 * 비밀번호는 passwordPrefill이 허락할 때만 넘긴다(아래).
 */
function humanLoginEnv({baseEnv=process.env,resources,stateRoot,credentials={},includePassword=false}){
  const env={};for(const key of OS_ENV_KEYS)if(baseEnv[key])env[key]=baseEnv[key];
  if(credentials.MAKEEDU_ID)env.MAKEEDU_ID=credentials.MAKEEDU_ID;
  if(includePassword&&credentials.MAKEEDU_PW)env.MAKEEDU_PW=credentials.MAKEEDU_PW;
  Object.assign(env,{ELECTRON_RUN_AS_NODE:'1',MAKEEDU_SESSION_FILE:makeeduSessionFile(stateRoot),PLAYWRIGHT_BROWSERS_PATH:path.join(resources,'browsers')});
  return env;
}
/**
 * 사람 창에 저장 비밀번호를 미리 채울까 — {include, note}.
 *   비밀번호·계정 계열(또는 읽지 못한) 멈춤이 있으면 채우지 않는다(note 'blocked') — 틀린 것으로 확인된 값을 그대로 누르면 시도 횟수가 준다(리뷰 2026-11-06).
 *   PC 설정이 잠겨 있으면 채우지 않는다(note 'locked') — 보이는 브라우저의 개발자 도구로 칸 값을 읽을 수 있어서(계정 설정과 같은 잠금).
 *   그 밖엔 채운다(note 'filled'). 아이디는 늘 채운다.
 */
function passwordPrefill({unlocked=false,block=null}={}){
  if(block&&blockFamily(block.code)!=='human')return{include:false,note:'blocked'};
  if(!unlocked)return{include:false,note:'locked'};
  return{include:true,note:'filled'};
}
/** 스크립트 출력의 마지막 결과 줄 → {ok, code, last}. 결과 줄이 없으면 끝 코드로만(0 = 성공으로 보지 않는다 — 저장을 확인 못 했다). */
function parseHumanLoginOutput(text,exitCode){
  const lines=String(text??'').split(/\r?\n/).filter(l=>l.startsWith(RESULT_TAG));
  for(const line of lines.reverse()){try{const r=JSON.parse(line.slice(RESULT_TAG.length));if(r&&typeof r.ok==='boolean'&&typeof r.code==='string')return{ok:r.ok&&exitCode===0,code:/^[A-Z_]{1,32}$/.test(r.code)?r.code:'ERROR',...(typeof r.blockKept==='string'&&/^[A-Za-z_]{1,40}$/.test(r.blockKept)?{blockKept:r.blockKept}:{}),...(['alive','dead','unknown'].includes(r.headless)?{headless:r.headless}:{}),last:r.last&&typeof r.last.code==='string'?{code:r.last.code,remaining:Number.isInteger(r.last.remaining)?r.last.remaining:null,captchaToken:r.last.captchaToken===true}:null};}catch{}}
  return{ok:false,code:exitCode==null?'LAUNCH_FAILED':'ERROR',last:null};
}
/** 멈춤 사유 짧은 문구(makeedu 화면 원문 기준 · 메이크에듀 칸 아래 한 줄). */
function blockReason(block){
  const remaining=Number.isInteger(block?.remaining)?block.remaining:null;
  switch(block?.code){
    case 'CAPTCHA_REQUIRED':return'makeedu가 사람 확인을 요구합니다';
    case 'NO_REJECT':return'makeedu가 사람 확인(재인증)을 요구합니다';
    case 'NO_LOGIN_CNT':return`로그인 정보가 올바르지 않습니다${remaining!=null?` · 남은 시도 ${remaining}회`:''}`;
    case 'NO_CHK':return'인증정보가 올바르지 않습니다';
    case 'NOK':return'계정이 미인증 상태입니다';
    case 'NO_PASS':return'호출정보가 올바르지 않습니다';
    case 'NO_PTYPE':return'무료형·실속형(라이트) 사용자로 안내됩니다';
    case 'NOK_LIMIT':return'사용 기한·결제 화면으로 안내됩니다';
    // 읽기 자체 실패(잠김·권한·백신 — readError)와 내용 깨짐은 할 일이 다르다(fix4 — 앞은 비밀번호 저장으로 안 풀림).
    case BLOCK_UNREADABLE:return block.readError?'동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등)':'동기화 PC의 멈춤 기록을 읽지 못했습니다';
    default:return`알 수 없는 응답(${safeCode(block?.code)})`;
  }
}
const RETRY=" 다시 'makeedu 다시 로그인'을 눌러 주세요.";
function lastResponseText(last){
  if(!last)return'';
  if(last.code==='NO_LOGIN_CNT')return` (마지막 makeedu 응답: 로그인 정보가 올바르지 않음${Number.isInteger(last.remaining)?` · 남은 시도 ${last.remaining}회`:''})`;
  if(last.code==='NO_REJECT')return' (마지막 makeedu 응답: 재인증 필요 — 재인증 화면까지 마쳐야 메인 화면이 나옵니다)';
  if(last.code==='CAPTCHA_REQUIRED')return' (마지막 makeedu 응답: 사람 확인 필요 — 확인 칸을 마친 뒤 로그인 버튼을 다시 눌러 주세요)';
  return/^[A-Z_]{1,32}$/.test(last.code)&&last.code!=='OK'?` (마지막 makeedu 응답: ${blockReason({code:last.code})})`:'';
}
/** 결과 → 화면 문구(한글 · 개인정보 없음). */
function humanLoginMessage(result){
  switch(result?.code){
    case 'OK':{
      const ok="다시 로그인되었습니다 — aywa의 '지금 동기화'로 바로 가져올 수 있습니다";
      if(!result.blockKept)return ok;
      // 실행기 결과(blockKept)에는 코드만 실려 읽기 실패·내용 깨짐을 가를 수 없다 — 두 경우를 함께 안내(메이크에듀 칸 안내는 readError로 갈라 보인다 · fix4).
      if(result.blockKept===BLOCK_UNREADABLE)return`${ok}. 다만 동기화 PC의 멈춤 기록을 읽지 못해 안전을 위해 자동 로그인 멈춤은 남겨 두었습니다(세션이 끊기면 자동 로그인은 하지 않습니다) — 기록 내용이 깨졌으면 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면(같은 값이어도) 풀리고, 기록 파일을 열 수 없으면(백신·권한·잠금) 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(메이크에듀 칸 안내 참고).`;
      return blockFamily(result.blockKept)==='password'
        ?`${ok}. 다만 비밀번호 확인 멈춤은 남아 있어 세션이 끊기면 자동 로그인은 하지 않습니다 — 관리 코드로 설정을 연 뒤 '연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장해 주세요.`
        :`${ok}. 다만 계정 확인 멈춤(${blockReason({code:result.blockKept})})은 남아 있어 세션이 끊기면 자동 로그인은 하지 않습니다 — makeedu에서 해결한 뒤 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장해 주세요(같은 값이어도).`;
    }
    case 'TIMEOUT':return`5분 안에 로그인을 마치지 못해 창을 닫았습니다.${lastResponseText(result.last)}${RETRY}`;
    case 'CLOSED':return`로그인 창이 닫혀 로그인을 마치지 못했습니다.${lastResponseText(result.last)}${RETRY}`;
    // 리뷰 13 — 사람 창에서는 로그인됐지만 정기 실행과 같은 headless 점검에서 그 세션이 거절됐다(우회하지 않는다 · 멈춤 그대로).
    case 'HEADLESS_REJECTED':return'사람 로그인은 됐지만 자동 실행에서 그 세션을 쓸 수 없습니다(makeedu가 브라우저를 바꾼 세션을 막는 것으로 보임) — makeedu 문의가 필요합니다. 자동 로그인 멈춤은 그대로입니다.';
    // 리뷰 14 — 캡차 토큰이 채워진 제출에도 makeedu가 다시 사람 확인을 요구했다('풀었는데 거절').
    case 'CAPTCHA_REJECTED':return'makeedu가 이 창의 로그인을 받지 않습니다(사람 확인을 마친 제출에도 다시 사람 확인을 요구했습니다) — makeedu 문의가 필요합니다.';
    case 'LAUNCH_FAILED':return'로그인 창(브라우저)을 열지 못했습니다 — 앱을 다시 시작한 뒤 시도해 주세요. 계속되면 로그 폴더를 확인해 주세요.';
    case 'SAVE_FAILED':return`로그인은 됐지만 로그인 상태를 저장하지 못했습니다.${RETRY}`;
    default:return'makeedu 다시 로그인을 마치지 못했습니다 — 로그 폴더를 확인해 주세요.';
  }
}
/**
 * 멈춤 표시 파일 하나 → null(없음) | {code, remaining, at} | 읽지 못함 {code:BLOCK_UNREADABLE, unreadable:true, readError}.
 * readError = 읽기 자체가 실패(잠김·권한 등 — 무엇인지 모르니 지우지 않는다) · 내용 깨짐은 readError:false. 지문·원문 문구는 싣지 않는다.
 */
function parseBlockFile(file){
  let text;
  try{text=fs.readFileSync(file,'utf8');}catch(e){return e?.code==='ENOENT'?null:{code:BLOCK_UNREADABLE,remaining:null,at:null,unreadable:true,readError:true};}
  try{const b=JSON.parse(text);if(!b||typeof b!=='object'||typeof b.code!=='string')throw new Error('shape');
    return{code:safeCode(b.code),remaining:Number.isInteger(b.remaining)?b.remaining:null,at:typeof b.at==='string'&&Number.isFinite(Date.parse(b.at))?b.at:null};}
  catch{return{code:BLOCK_UNREADABLE,remaining:null,at:null,unreadable:true,readError:false};}
}
/**
 * 본·예비 표시 중 어느 것을 볼까 — ⚠️ 워커 login-guard.cjs readBlock과 **같은 규칙**(재리뷰 경미 2 · 시험이 같은 파일 묶음으로 둘을 맞춘다):
 * 본이 없으면 예비 · 본을 못 읽으면 읽을 수 있는 예비 · 둘 다 읽히면 **더 최근(at) 것** · 같거나 모르면 본. 예비를 고르면 fallback:true.
 * (연동 앱은 asar에, 워커는 따로 갱신되는 runtime에 있어 함수 하나를 함께 require하지 않고 규칙을 옮겨 두었다.)
 */
function pickBlock(main,alt){
  const altOk=alt&&!alt.unreadable?{...alt,fallback:true}:null;
  if(!main)return altOk??alt;
  if(main.unreadable)return altOk??main;
  if(altOk&&Date.parse(altOk.at??'')>Date.parse(main.at??''))return altOk;
  return main;
}
let cache={key:null,value:null};
const statKey=f=>{try{const st=fs.statSync(f);return`${st.mtimeMs}:${st.size}`;}catch(e){return e?.code==='ENOENT'?'-':'err';}};
/**
 * 자동 로그인 멈춤 표시 → {code, remaining, family, human, fallback, at, reason[, readError]} | null(readError는 BLOCK_UNREADABLE일 때만 —
 * true = 파일 읽기 자체 실패 · false = 내용 깨짐). 본·예비(.alt.json — 본 파일을 못 써서 워커가 남긴 것)를
 * 둘 다 읽어 워커와 같은 규칙(pickBlock)으로 고른다 — 예비면 fallback:true. 자격 지문(credHash·credSalt)·원문 문구는 화면에 싣지 않는다.
 * 두 파일의 판(수정 시각·크기)이 바뀔 때만 다시 읽는다.
 */
function readLoginBlock(stateRoot){
  const files=blockFiles(stateRoot),stats=files.map(statKey);
  if(stats.every(s=>s==='-')){cache={key:null,value:null};return null;}
  const key=`${stateRoot}|${stats.join('|')}`;if(cache.key===key)return cache.value;
  const picked=pickBlock(parseBlockFile(files[0]),parseBlockFile(files[1]));
  let value=null;
  if(picked){value={code:picked.code,remaining:picked.remaining,at:picked.at};
    if(picked.unreadable)value.readError=picked.readError===true; // 읽기 자체 실패 vs 내용 깨짐 — 화면 문구만 가른다(fix4)
    value.family=blockFamily(value.code);value.human=value.family==='human';value.fallback=!!picked.fallback;value.reason=blockReason(value);}
  cache=stats.includes('err')?{key:null,value:null}:{key,value};return value;
}
/**
 * 보이는 창으로 사람 로그인 실행. 워커와 같은 WorkerHost(작업 묶음 — 앱이 끝나면 창도 같이 닫힌다)로 띄운다.
 * WorkerHost는 콘솔 창만 숨긴다(CREATE_NO_WINDOW) — Playwright가 띄우는 Chromium 창은 숨기지 않는다(windowsHide 미지정 · SW_SHOWDEFAULT).
 * stdout·stderr는 onOutput(앱 로그 · 비밀 가림)으로, 끝나면 onDone({ok,code,last}).
 */
function startHumanLogin({resources,executable,env,onOutput=()=>{},onDone,spawnImpl=spawn}){
  const runtime=path.join(resources,'runtime');let out='',settled=false;
  const finish=code=>{if(settled)return;settled=true;onDone(parseHumanLoginOutput(out,code));};
  let child;
  try{child=spawnImpl(path.join(resources,'WorkerHost.exe'),[executable,path.join(runtime,SCRIPT)],{cwd:runtime,env,windowsHide:true,stdio:['pipe','pipe','pipe']});}
  catch{queueMicrotask(()=>finish(null));return{stop(){}};}
  child.stdout?.on('data',chunk=>{out=(out+chunk.toString('utf8')).slice(-16384);onOutput(chunk);});
  child.stderr?.on('data',chunk=>onOutput(chunk));
  child.once('error',()=>finish(null));child.once('close',code=>finish(code));
  return{stop(){try{child.stdin?.destroy();}catch{}}};
}
/**
 * 비밀번호·계정 계열 멈춤을 푼다 — 본·예비 표시를 **파일마다** 갈래를 보고 그 계열 파일만 지운다(재리뷰 경미 2) · 사람 확인 계열 파일은
 * 그대로('makeedu 다시 로그인'으로 푼다). 읽기 오류(잠김·권한 등) 파일은 지우지 않는다(리뷰 9b — 무엇인지 모르는 표시) · 다른 파일은 따로 본다.
 * 내용이 깨진 표시는 '멈춤 기록을 읽지 못함'(BLOCK_UNREADABLE · 계정 계열)으로 보고 지운다.
 * 비밀번호 원문은 보지도 남기지도 않는다(표시 파일의 코드만 읽는다). 돌려주는 값: 지운 코드(둘 다 지웠으면 마지막 것) · 없으면 null.
 */
function clearCredentialBlock(stateRoot){
  let cleared=null;
  for(const file of blockFiles(stateRoot)){
    const b=parseBlockFile(file);
    if(!b||b.readError||isHumanBlock(b.code))continue;
    fs.rmSync(file,{force:true});cleared=b.code;
  }
  cache={key:null,value:null};return cleared;
}
/**
 * 'PC 설정 → 연동 계정' 저장 — **makeedu 비밀번호가 저장될 때만**(같은 값이어도) 비밀번호·계정 계열 멈춤을 푼다(리뷰 2).
 * 아이디만 바꾼 저장은 풀지 않는다 — 자격이 바뀌면 워커의 지문 비교(credHash)가 이미 한 번 다시 시도하게 한다.
 */
function credentialsSaved(stateRoot,input){
  if(!input||typeof input.MAKEEDU_PW!=='string'||input.MAKEEDU_PW==='')return null;
  return clearCredentialBlock(stateRoot);
}
module.exports={HUMAN_BLOCK_CODES,PASSWORD_BLOCK_CODES,BLOCK_UNREADABLE,isHumanBlock,blockFamily,pickBlock,passwordPrefill,credentialsSaved,clearCredentialBlock,SCRIPT,RESULT_TAG,makeeduSessionFile,humanLoginEnv,parseHumanLoginOutput,humanLoginMessage,blockReason,readLoginBlock,startHumanLogin};
