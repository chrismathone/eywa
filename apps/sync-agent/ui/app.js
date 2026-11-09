const $=id=>document.getElementById(id);let latest=null,dirty=false,pending=false;
const options={autoStart:'Windows 로그인 시 자동 실행',startMinimized:'시작할 때 알림 영역에 두기',paused:'이 PC에서 연동 일시 중지',classnoteEnabled:'클래스노트 · 영상 보관 실행',makeeduEnabled:'메이크에듀 실행',autoDownload:'새 버전 자동 다운로드'};
for(const [key,label]of Object.entries(options)){const row=document.createElement('label');row.append(document.createTextNode(label));const input=document.createElement('input');input.type='checkbox';input.id=key;row.append(input);$('toggles').append(row);}
$('settings-form').addEventListener('change',()=>dirty=true);
const states={off:'꺼짐',waiting:'대기',running:'실행 중',draining:'현재 작업 마무리 중',error:'확인 후 다시 시도 중'};
const updates={idle:'최신 버전 확인 대기',downloading:'다운로드 중',ready:'다운로드 완료 · 적용 방법 선택',applying:'적용 중',rollback:'이전 버전 복구',error:'업데이트 준비 실패'};
const phases={checking:'새 버전 확인 중',copying:'그대로 쓸 파일 복사 중',downloading:'다운로드 중',verifying:'다운로드 파일 검증 중',extracting:'압축 해제 · 파일 검증 중',finalizing:'설치 준비 마무리 중'};
const moduleNames={classnote:'클래스노트',makeedu:'메이크에듀'};
// 업데이트가 기다리는 작업 — '클래스노트 · 보고서 발송 (3분째)'. 이름을 모르면 모듈 이름만(옛 워커).
function activityText(a){const minutes=Math.max(0,Math.floor((Date.now()-a.since)/60000));return `${moduleNames[a.module]??a.module} · ${a.label??(a.task?'작업':'다음 작업 준비')}${a.task&&minutes?` (${minutes}분째)`:''}`;}
function renderApply(s){
  const step=s.updateInfo?.applyStep==='switch'?2:s.updateInfo?.applyStep==='drain'?1:s.updateInfo?.justUpdated&&!s.online?3:0;
  $('apply-overlay').hidden=!step;if(!step)return;
  const version=step===3?s.updateInfo.justUpdated.version:s.updateInfo?.ready?.version??s.updateInfo?.plan?.version;
  $('apply-version').textContent=version?`v${version}`:'';$('apply-progress').value=step;
  for(const n of [1,2,3]){const li=$(`apply-step-${n}`);li.className=n<step?'done':n===step?'current':'';}
  const waiting=(s.activity??[]).map(activityText);
  $('apply-detail').textContent=step===1?(waiting.length?`마무리를 기다리는 작업: ${waiting.join(', ')}`:'작업을 정리하고 있습니다.'):step===2?'잠시 후 창이 닫혔다가 새 버전으로 다시 열립니다.':'새 버전이 서버에 연결하고 있습니다.';
  $('apply-cancel').hidden=step!==1;
}
const localTime=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
function updateControls(s){
  const allowed=!pending&&s.online&&s.configuration?.updatesEnabled&&!s.updateInfo?.closing;
  $('update').disabled=!allowed||s.updateInfo?.pending||s.update==='downloading';
  for(const id of ['update-now','update-schedule','update-at'])$(id).disabled=!allowed||s.updateInfo?.pending||!s.updateInfo?.ready||s.update==='applying';
  $('update-cancel').disabled=pending||s.updateInfo?.closing||s.update==='applying';
  $('makeedu-login').disabled=pending||!!s.makeeduLogin?.running||!!s.updateInfo?.closing;
}
// 메이크에듀 '다시 로그인'(2026-11-06) — 창이 열려 있는 동안 · 자동 로그인 멈춤 사유를 메이크에듀 칸 아래 한 줄로.
function makeeduLoginText(s){
  const m=s.makeeduLogin;if(!m)return'';
  // 창을 열 때 비밀번호를 채웠나 — blocked = 비밀번호·계정 확인 멈춤이라 일부러 안 채움(틀린 값을 그대로 누르면 시도 횟수가 준다) · locked = 설정 잠금.
  const pw={filled:'',locked:'비밀번호는 직접 입력해 주세요. ',blocked:'자동 로그인 멈춤(비밀번호·계정 확인) 중이라 저장된 비밀번호는 채우지 않았습니다 — 비밀번호를 직접 입력해 주세요. '}[m.passwordNote]??'';
  if(m.running)return`로그인 창이 열려 있습니다 — 안 보이면 작업 표시줄의 Chrome for Testing 창을 눌러 주세요. ${pw}로그인 버튼과 사람 확인은 그 창에서 직접 눌러 주세요(5분 안에).`;
  if(!m.blocked)return'';
  const b=m.blocked,family=b.family??(b.human?'human':'password');
  const since=b.at?` (${new Date(b.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})}부터)`:'';
  // 직전 '다시 로그인'이 makeedu 쪽에서 막혔으면(headless 재사용 거절 · 캡차를 풀었는데 거절) 다시 눌러도 풀리지 않는다 — makeedu 문의.
  const vendorBlocked=['HEADLESS_REJECTED','CAPTCHA_REJECTED'].includes(m.result?.code);
  const todo=family==='human'?(vendorBlocked?"'makeedu 다시 로그인'으로는 풀리지 않았습니다 — makeedu 문의가 필요합니다(위 안내 참고).":"'makeedu 다시 로그인'을 눌러 주세요.")
    :family==='password'?"관리 코드로 설정을 연 뒤 '연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장하면 풀립니다(그동안 'makeedu 다시 로그인'으로 받은 세션은 계속 씁니다 · 그 창에서는 비밀번호를 직접 입력)."
    // 멈춤 기록 파일을 읽지 못함 — makeedu가 거절한 게 아니라 안전을 위해 멈춘 것(makeedu에서 해결할 일 없음).
    // 파일 읽기 자체 실패(readError)는 비밀번호 저장으로 풀리지 않는다 — PC 재시작·백신 예외·폴더 권한(fix4).
    :b.code==='BLOCK_UNREADABLE'&&b.readError?"안전을 위해 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다)."
    :b.code==='BLOCK_UNREADABLE'?"안전을 위해 멈춰 두었습니다 · 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다."
    :"makeedu에서 해결한 뒤 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다.";
  const alt=b.fallback?' ⚠️ 멈춤 표시를 예비 파일에 남겼습니다(본 파일 저장 실패 — 로그 폴더를 확인해 주세요).':'';
  return`자동 로그인 멈춤 · ${b.reason}${since} — ${todo}${alt}`;
}
function render(s){latest=s;$('version').textContent=`v${s.version}`;$('subtitle').textContent=s.tenantName||'하나의 앱에서 지점의 연동을 관리합니다.';
  $('pair').hidden=s.paired;$('status').hidden=!s.paired;$('unlock').hidden=!s.paired||s.unlocked;$('management').hidden=!s.paired||!s.unlocked;
  $('reset').hidden=!s.revoked;
  if(s.unlocked&&$('unlock-code').value)$('unlock-code').value='';if(s.paired&&$('pair-code').value)$('pair-code').value='';
  $('message').textContent=s.message;$('online').textContent=s.online?'서버 연결됨':'서버 연결 확인 중';
  for(const m of ['classnote','makeedu']){const a=(s.activity??[]).find(x=>x.module===m);$(m+'-state').textContent=(states[s.modules[m]]||'확인 중')+(a?.label?` · ${a.label}`:'');}
  const loginText=makeeduLoginText(s);$('makeedu-login-state').textContent=loginText;$('makeedu-login-state').hidden=!loginText;
  $('server-gate').textContent=!s.configuration?.cutoverReady?'기존 워커 확인과 계정 설정을 마치면 연동을 시작합니다.':s.configuration.enabled?'웹과 이 PC 양쪽에서 켜 둔 연동이 작동합니다.':'웹에서 이 PC의 연동 실행이 꺼져 있습니다.';
  const progress=s.updateInfo?.progress;
  $('update-state').textContent=phases[progress?.phase]||updates[s.update]||'확인 중';
  $('updates').hidden=!s.paired;
  const ready=s.updateInfo?.ready,plan=s.updateInfo?.plan;
  // 복사·압축 해제는 용량으로도 센다(원장 2026-11-06 — 큰 파일이 앞에 몰려 있어 파일 수로 세면 '67 / 10,021개 파일 · 0%'가 용량으로는 약 23%였다). 문구엔 파일 수도 함께 쓴다. 퍼센트 = 용량과 파일 수의 평균(원장 2026-11-09 — 용량만 세면 큰 파일이 앞에 몰려 파일 10%에서 82%가 되어 80%대에 몇 분 머물고, 파일 수만 세면 큰 파일을 옮기는 처음에 0%에 멈춘다). 용량이 없는 값(옛 판·다른 단계)은 종전대로.
  const sized=['copying','extracting'].includes(progress?.phase)&&progress.totalBytes>0,count=sized||progress?.total>0;
  const byteFrac=sized?(Number(progress.bytes)||0)/progress.totalBytes:0,fileFrac=sized&&progress.total>0?(Number(progress.completed)||0)/progress.total:byteFrac;
  const percent=sized?Math.min(100,Math.floor((byteFrac+fileFrac)/2*100)):count?Math.min(100,Math.floor(progress.completed/progress.total*100)):0;
  const toMB=n=>((Number(n)||0)/1024/1024).toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1}),toCount=n=>(Number(n)||0).toLocaleString('ko-KR');
  $('update-progress-wrap').hidden=!count;
  $('update-progress').value=percent;
  $('update-progress-text').textContent=!count?'':sized?`${toMB(progress.bytes)} / ${toMB(progress.totalBytes)} MB · ${toCount(progress.completed)} / ${toCount(progress.total)}개 파일 · ${percent}%`:['copying','extracting','finalizing'].includes(progress.phase)?`${progress.completed.toLocaleString('ko-KR')} / ${progress.total.toLocaleString('ko-KR')}개 파일 · ${percent}%`:`${toMB(progress.completed)} / ${toMB(progress.total)} MB · ${percent}%`;
  let detail=ready?`v${ready.version} 다운로드 완료. 지금 업데이트하거나 시간을 지정해 주세요.`:
    progress?.phase==='checking'?'서버에서 새 버전을 확인하고 있습니다.':
    progress?.phase==='copying'?`v${progress.version} · 지금 버전에서 그대로 쓸 수 있는 파일을 복사하고 있습니다.`:
    progress?.phase==='downloading'?(progress.files?`v${progress.version} · 바뀐 파일 ${progress.files.toLocaleString('ko-KR')}개만 받고 있습니다.`:`v${progress.version} 설치 파일을 받고 있습니다.`):
    progress?.phase==='verifying'?'다운로드한 파일이 올바른지 확인하고 있습니다.':
    progress?.phase==='extracting'?'다운로드가 끝났습니다. 설치에 필요한 파일을 풀고 검증하고 있습니다.':
    progress?.phase==='finalizing'?'파일 검증이 끝났습니다. 적용할 버전을 준비하고 있습니다.':
    s.updateInfo?.failure?s.updateInfo.failure:
    s.update==='error'?'업데이트 준비를 마치지 못했습니다. 새 버전 확인으로 다시 시도해 주세요.':
    s.updateInfo?.checkedAt?'현재 최신 버전입니다.':
    s.local.autoDownload?'아직 새 버전을 확인하지 않았습니다. 새 버전 확인을 눌러 주세요.':'자동 다운로드가 꺼져 있습니다. 새 버전 확인을 눌러 주세요.';
  if(plan?.state==='scheduled')detail=`v${plan.version} · ${new Date(plan.at).toLocaleString('ko-KR')} 예약됨`;
  if(plan?.state==='waiting'){const waiting=(s.activity??[]).map(activityText);detail=`v${plan.version} · 현재 작업${waiting.length?`(${waiting.join(', ')})`:''}을 마친 뒤 적용합니다. 대기 중에는 취소할 수 있습니다.`;}
  if(plan?.state==='missed')detail=`v${plan.version} · 예약·적용 대기가 중단되었습니다. 적용 시점을 다시 선택해 주세요.`;
  if(plan?.state==='failed')detail=`v${plan.version} · 적용하지 못했습니다. 새 버전을 확인한 뒤 다시 선택해 주세요.`;
  $('update-detail').textContent=detail;
  $('update-checked').textContent=s.updateInfo?.checkedAt?`마지막 버전 확인: ${new Date(s.updateInfo.checkedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)`:'';
  $('update-permission').textContent=!s.configuration?.updatesEnabled?'웹에서 업데이트가 허용되어야 적용할 수 있습니다.':!s.online?'서버에 연결되면 업데이트를 선택할 수 있습니다.':'';
  $('update-cancel').hidden=!plan;$('update-schedule').textContent=plan?.state==='scheduled'?'예약 변경':'시간 지정';
  $('update-at').min=localTime(new Date(Math.ceil((Date.now()+60_000)/60_000)*60_000));
  if(!$('update-at').value)$('update-at').value=localTime(new Date(Math.ceil((Date.now()+5*60_000)/60_000)*60_000));
  $('credential-status').textContent=['CLASSNOTE_UPLOAD_ID','MAKEEDU_ID'].map(k=>`${k.startsWith('CLASSNOTE')?'클래스노트':'메이크에듀'}: ${s.credentials[k]?'저장됨':'설정 필요'}`).join(' · ');
  if(!dirty)for(const key of Object.keys(options))$(key).checked=s.local[key];
  updateControls(s);renderApply(s);
}
async function command(action,input){if(pending)return;pending=true;$('error').textContent='';$('apply-error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await window.agent.command(action,input);if(!r.ok)$('error').textContent=$('apply-error').textContent=r.error;else{if(r.state)render(r.state);if(r.legacy)$('legacy-state').textContent=`기존 실행 ${r.legacy.running}개 · 예약 작업 ${r.legacy.tasks.length}개`;return r;}}
  catch{$('error').textContent=$('apply-error').textContent='요청을 처리하지 못했습니다. 앱을 다시 열어 주세요.';}
  finally{pending=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(latest)updateControls(latest);}}
$('pair-form').addEventListener('submit',e=>{e.preventDefault();void command('pair',{code:$('pair-code').value});});
$('unlock-form').addEventListener('submit',e=>{e.preventDefault();void command('unlock',{code:$('unlock-code').value});});
$('credentials-form').addEventListener('submit',async e=>{e.preventDefault();const input=Object.fromEntries([...new FormData(e.target)].filter(([,v])=>v!==''));if(await command('credentials',input))e.target.reset();});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();const settings={...latest.local};for(const key of Object.keys(options))settings[key]=$(key).checked;if(await command('settings',settings))dirty=false;});
$('schedule-form').addEventListener('submit',e=>{e.preventDefault();const at=new Date($('update-at').value);if(!Number.isFinite(at.getTime())){$('error').textContent='예약 날짜와 시간을 지정해 주세요.';return;}void command('update-schedule',{sequence:latest.updateInfo?.ready?.sequence,at:at.toISOString()});});
$('update-now').addEventListener('click',()=>void command('update-now',{sequence:latest.updateInfo?.ready?.sequence}));
for(const id of ['import','legacy','cutover','update','update-cancel','quit','reset','logs','makeedu-login'])$(id).addEventListener('click',()=>void command(id));
$('apply-cancel').addEventListener('click',()=>void command('update-cancel'));
window.agent.onState(render);void command('state');
