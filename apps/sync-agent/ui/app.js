const $=id=>document.getElementById(id);let latest=null,dirty=false,pending=false;
const options={autoStart:'Windows 로그인 시 자동 실행',startMinimized:'시작할 때 알림 영역에 두기',paused:'이 PC에서 연동 일시 중지',classnoteEnabled:'클래스노트 · 영상 보관 실행',makeeduEnabled:'메이크에듀 실행',autoUpdate:'새 버전 자동 다운로드·적용'};
for(const [key,label]of Object.entries(options)){const row=document.createElement('label');row.append(document.createTextNode(label));const input=document.createElement('input');input.type='checkbox';input.id=key;row.append(input);$('toggles').append(row);}
for(const id of ['updateStartHour','updateEndHour'])for(let i=0;i<24;i++){const o=document.createElement('option');o.value=String(i);o.textContent=`${String(i).padStart(2,'0')}:00`;$(id).append(o);}
$('settings-form').addEventListener('change',()=>dirty=true);
const states={off:'꺼짐',waiting:'대기',running:'실행 중',draining:'현재 작업 마무리 중',error:'확인 후 다시 시도 중'};
const updates={idle:'최신 버전 확인 대기',downloading:'다운로드 중',ready:'작업 종료 대기',applying:'적용 중',rollback:'이전 버전 복구',error:'잠시 후 다시 확인'};
function render(s){latest=s;$('version').textContent=`v${s.version}`;$('subtitle').textContent=s.tenantName||'하나의 앱에서 지점의 연동을 관리합니다.';
  $('pair').hidden=s.paired;$('status').hidden=!s.paired;$('unlock').hidden=!s.paired||s.unlocked;$('management').hidden=!s.paired||!s.unlocked;
  $('reset').hidden=!s.revoked;
  $('message').textContent=s.message;$('online').textContent=s.online?'서버 연결됨':'서버 연결 확인 중';
  for(const m of ['classnote','makeedu'])$(m+'-state').textContent=states[s.modules[m]]||'확인 중';
  $('server-gate').textContent=!s.configuration?.cutoverReady?'기존 워커 확인과 계정 설정을 마치면 연동을 시작합니다.':s.configuration.enabled?'웹과 이 PC 양쪽에서 켜 둔 연동이 작동합니다.':'웹에서 이 PC의 연동 실행이 꺼져 있습니다.';
  $('update-state').textContent=updates[s.update]||'확인 중';
  $('credential-status').textContent=['CLASSNOTE_UPLOAD_ID','MAKEEDU_ID'].map(k=>`${k.startsWith('CLASSNOTE')?'클래스노트':'메이크에듀'}: ${s.credentials[k]?'저장됨':'설정 필요'}`).join(' · ');
  if(!dirty){for(const key of Object.keys(options))$(key).checked=s.local[key];for(const key of ['updateStartHour','updateEndHour'])$(key).value=String(s.local[key]);}
}
async function command(action,input){if(pending)return;pending=true;$('error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await window.agent.command(action,input);if(!r.ok)$('error').textContent=r.error;else{if(r.state)render(r.state);if(r.legacy)$('legacy-state').textContent=`기존 실행 ${r.legacy.running}개 · 예약 작업 ${r.legacy.tasks.length}개`;return r;}}
  catch{$('error').textContent='요청을 처리하지 못했습니다. 앱을 다시 열어 주세요.';}
  finally{pending=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
$('pair-form').addEventListener('submit',e=>{e.preventDefault();void command('pair',{code:$('pair-code').value});});
$('unlock-form').addEventListener('submit',e=>{e.preventDefault();void command('unlock',{code:$('unlock-code').value});});
$('credentials-form').addEventListener('submit',async e=>{e.preventDefault();const input=Object.fromEntries([...new FormData(e.target)].filter(([_k,v])=>v!==''));if(await command('credentials',input))e.target.reset();});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();const settings={...latest.local};for(const key of Object.keys(options))settings[key]=$(key).checked;for(const key of ['updateStartHour','updateEndHour'])settings[key]=Number($(key).value);if(await command('settings',settings))dirty=false;});
for(const id of ['import','legacy','cutover','update','quit','reset'])$(id).addEventListener('click',()=>void command(id));
window.agent.onState(render);void command('state');
