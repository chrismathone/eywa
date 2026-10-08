const $=id=>document.getElementById(id);let latest=null,dirty=false,pending=false;
const options={autoStart:'Windows 로그인 시 자동 실행',startMinimized:'시작할 때 알림 영역에 두기',paused:'이 PC에서 연동 일시 중지',classnoteEnabled:'클래스노트 · 영상 보관 실행',makeeduEnabled:'메이크에듀 실행',autoDownload:'새 버전 자동 다운로드'};
for(const [key,label]of Object.entries(options)){const row=document.createElement('label');row.append(document.createTextNode(label));const input=document.createElement('input');input.type='checkbox';input.id=key;row.append(input);$('toggles').append(row);}
$('settings-form').addEventListener('change',()=>dirty=true);
const states={off:'꺼짐',waiting:'대기',running:'실행 중',draining:'현재 작업 마무리 중',error:'확인 후 다시 시도 중'};
const updates={idle:'최신 버전 확인 대기',downloading:'다운로드 중',ready:'다운로드 완료 · 적용 방법 선택',applying:'적용 중',rollback:'이전 버전 복구',error:'잠시 후 다시 확인'};
const localTime=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
function updateControls(s){
  const allowed=!pending&&s.unlocked&&s.online&&s.configuration?.updatesEnabled&&!s.updateInfo?.closing;
  $('update').disabled=!allowed||s.update==='downloading';
  for(const id of ['update-now','update-schedule','update-at'])$(id).disabled=!allowed||!s.updateInfo?.ready||s.update==='applying';
  $('update-cancel').disabled=pending||!s.unlocked||s.updateInfo?.closing||s.update==='applying';
}
function render(s){latest=s;$('version').textContent=`v${s.version}`;$('subtitle').textContent=s.tenantName||'하나의 앱에서 지점의 연동을 관리합니다.';
  $('pair').hidden=s.paired;$('status').hidden=!s.paired;$('unlock').hidden=!s.paired||s.unlocked;$('management').hidden=!s.paired||!s.unlocked;
  $('reset').hidden=!s.revoked;
  $('message').textContent=s.message;$('online').textContent=s.online?'서버 연결됨':'서버 연결 확인 중';
  for(const m of ['classnote','makeedu'])$(m+'-state').textContent=states[s.modules[m]]||'확인 중';
  $('server-gate').textContent=!s.configuration?.cutoverReady?'기존 워커 확인과 계정 설정을 마치면 연동을 시작합니다.':s.configuration.enabled?'웹과 이 PC 양쪽에서 켜 둔 연동이 작동합니다.':'웹에서 이 PC의 연동 실행이 꺼져 있습니다.';
  $('update-state').textContent=updates[s.update]||'확인 중';
  $('updates').hidden=!s.paired;
  const ready=s.updateInfo?.ready,plan=s.updateInfo?.plan;
  let detail=ready?`v${ready.version} 다운로드 완료. 지금 업데이트하거나 시간을 지정해 주세요.`:'다운로드가 끝나면 적용 방법을 선택할 수 있습니다.';
  if(plan?.state==='scheduled')detail=`v${plan.version} · ${new Date(plan.at).toLocaleString('ko-KR')} 예약됨`;
  if(plan?.state==='waiting')detail=`v${plan.version} · 현재 작업을 마친 뒤 적용합니다. 대기 중에는 취소할 수 있습니다.`;
  if(plan?.state==='missed')detail=`v${plan.version} · 예약·적용 대기가 중단되었습니다. 적용 시점을 다시 선택해 주세요.`;
  if(plan?.state==='failed')detail=`v${plan.version} · 적용하지 못했습니다. 새 버전을 확인한 뒤 다시 선택해 주세요.`;
  $('update-detail').textContent=detail;
  $('update-permission').textContent=!s.unlocked?'관리 코드로 PC 설정을 열면 업데이트를 선택할 수 있습니다.':!s.configuration?.updatesEnabled?'웹에서 업데이트가 허용되어야 적용할 수 있습니다.':!s.online?'서버에 연결되면 업데이트를 선택할 수 있습니다.':'';
  $('update-cancel').hidden=!plan;$('update-schedule').textContent=plan?.state==='scheduled'?'예약 변경':'시간 지정';
  $('update-at').min=localTime(new Date(Math.ceil((Date.now()+60_000)/60_000)*60_000));
  if(!$('update-at').value)$('update-at').value=localTime(new Date(Math.ceil((Date.now()+5*60_000)/60_000)*60_000));
  $('credential-status').textContent=['CLASSNOTE_UPLOAD_ID','MAKEEDU_ID'].map(k=>`${k.startsWith('CLASSNOTE')?'클래스노트':'메이크에듀'}: ${s.credentials[k]?'저장됨':'설정 필요'}`).join(' · ');
  if(!dirty)for(const key of Object.keys(options))$(key).checked=s.local[key];
  updateControls(s);
}
async function command(action,input){if(pending)return;pending=true;$('error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await window.agent.command(action,input);if(!r.ok)$('error').textContent=r.error;else{if(r.state)render(r.state);if(r.legacy)$('legacy-state').textContent=`기존 실행 ${r.legacy.running}개 · 예약 작업 ${r.legacy.tasks.length}개`;return r;}}
  catch{$('error').textContent='요청을 처리하지 못했습니다. 앱을 다시 열어 주세요.';}
  finally{pending=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(latest)updateControls(latest);}}
$('pair-form').addEventListener('submit',e=>{e.preventDefault();void command('pair',{code:$('pair-code').value});});
$('unlock-form').addEventListener('submit',e=>{e.preventDefault();void command('unlock',{code:$('unlock-code').value});});
$('credentials-form').addEventListener('submit',async e=>{e.preventDefault();const input=Object.fromEntries([...new FormData(e.target)].filter(([,v])=>v!==''));if(await command('credentials',input))e.target.reset();});
$('settings-form').addEventListener('submit',async e=>{e.preventDefault();const settings={...latest.local};for(const key of Object.keys(options))settings[key]=$(key).checked;if(await command('settings',settings))dirty=false;});
$('schedule-form').addEventListener('submit',e=>{e.preventDefault();const at=new Date($('update-at').value);if(!Number.isFinite(at.getTime())){$('error').textContent='예약 날짜와 시간을 지정해 주세요.';return;}void command('update-schedule',{sequence:latest.updateInfo?.ready?.sequence,at:at.toISOString()});});
$('update-now').addEventListener('click',()=>void command('update-now',{sequence:latest.updateInfo?.ready?.sequence}));
for(const id of ['import','legacy','cutover','update','update-cancel','quit','reset','logs'])$(id).addEventListener('click',()=>void command(id));
window.agent.onState(render);void command('state');
