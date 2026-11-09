// 메이크에듀 칸 안내(2026-11-06) — 실제 ui/app.js를 작은 DOM 대역 위에서 돌리고, 앱 lib(readLoginBlock·humanLoginMessage)가 만든 상태를 넣는다.
// 지키는 것: 사람 확인·재인증 멈춤 → 'makeedu 다시 로그인' / 비밀번호·계정 멈춤 → '연동 계정에 다시 저장'(사람 로그인이 성공한 뒤에도 남는다).
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const M=require('../lib/makeedu-login.cjs');
const APP=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8');
const HTML=fs.readFileSync(path.join(__dirname,'../ui/index.html'),'utf8');

function element(id){
  const el={id,textContent:'',hidden:false,disabled:false,value:'',checked:false,className:'',min:'',listeners:{},
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},append(){},reset(){}};
  return el;
}
function mount(){
  const els=new Map(),buttons=[];
  const get=id=>{if(!els.has(id)){const el=element(id);els.set(id,el);if(/^(makeedu-login|import|legacy|cutover|update|update-now|update-cancel|quit|reset|logs|apply-cancel)$/.test(id))buttons.push(el);}return els.get(id);};
  let onState=null;const calls=[];
  const document={getElementById:get,createElement:()=>element(''),createTextNode:t=>({t}),querySelectorAll:sel=>sel==='button'?buttons:[]};
  const window={agent:{command:async(action)=>{calls.push(action);return{ok:true};},onState:fn=>{onState=fn;return()=>{};}}};
  vm.runInNewContext(APP,{document,window,FormData:class{},console});
  return{render:state=>onState(state),el:get,calls};
}
const base={version:'1.0.17',tenantName:'시험 지점',paired:true,revoked:false,online:true,unlocked:false,
  local:{autoStart:true,startMinimized:false,paused:false,classnoteEnabled:true,makeeduEnabled:true,autoDownload:true},
  configuration:{cutoverReady:true,enabled:true,updatesEnabled:true},modules:{classnote:'running',makeedu:'running'},update:'idle',message:'',
  updateInfo:{ready:null,plan:null,progress:null,pending:false,failure:null,checkedAt:null,closing:false,applyStep:null,justUpdated:null},
  activity:[],credentials:{},events:[],makeeduLogin:{running:false,result:null,blocked:null}};
function blockedState(code,extra={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-ui-makeedu-'));
  try{const file=path.join(root,'makeedu','login-blocked.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify({code,message:'m',at:'2026-11-05T21:00:03.000Z',credSalt:'0'.repeat(32),credHash:'1'.repeat(32),...extra}));
    return M.readLoginBlock(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('index.html에 메이크에듀 칸 버튼·안내 줄이 있다',()=>{
  // 버튼은 칸 제목 줄 오른쪽(원장 2026-11-06 "우상단에 · 하단에 공간낭비 하지말고") · 안내 줄은 상태 아래.
  assert.match(HTML,/<article><div class="module-head"><h3>메이크에듀<\/h3><button id="makeedu-login" class="secondary">makeedu 다시 로그인<\/button><\/div><strong id="makeedu-state"><\/strong><p id="makeedu-login-state" hidden><\/p><\/article>/);
});

test('사람 확인·재인증 멈춤 — "makeedu 다시 로그인을 눌러 주세요"',()=>{
  const ui=mount();
  ui.render({...base,makeeduLogin:{running:false,result:null,blocked:blockedState('CAPTCHA_REQUIRED')}});
  assert.match(ui.el('makeedu-login-state').textContent,/^자동 로그인 멈춤 · makeedu가 사람 확인을 요구합니다 \(11월 6일 06:00부터\) — 'makeedu 다시 로그인'을 눌러 주세요\.$/);
  assert.equal(ui.el('makeedu-login-state').hidden,false);
  ui.render({...base,makeeduLogin:{running:false,result:null,blocked:blockedState('NO_REJECT')}});
  assert.match(ui.el('makeedu-login-state').textContent,/^자동 로그인 멈춤 · makeedu가 사람 확인\(재인증\)을 요구합니다 .* — 'makeedu 다시 로그인'을 눌러 주세요\.$/);
});

test('비밀번호 계열 멈춤 — 원인(makeedu 원문) + 비밀번호 확인해 다시 저장 · 사람 로그인이 성공한 뒤에도 남는다',()=>{
  const ui=mount();
  const blocked=blockedState('NO_LOGIN_CNT',{remaining:3});
  ui.render({...base,makeeduLogin:{running:false,result:null,blocked}});
  assert.equal(ui.el('makeedu-login-state').textContent,
    "자동 로그인 멈춤 · 로그인 정보가 올바르지 않습니다 · 남은 시도 3회 (11월 6일 06:00부터) — 관리 코드로 설정을 연 뒤 '연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장하면 풀립니다(그동안 'makeedu 다시 로그인'으로 받은 세션은 계속 씁니다 · 그 창에서는 비밀번호를 직접 입력).");
  // 사람 로그인 성공(blockKept) — 멈춤 표시는 그대로라 칸 안내가 남고, 위 안내 문구도 다시 저장을 말한다
  const result={ok:true,code:'OK',blockKept:'NO_LOGIN_CNT'};
  ui.render({...base,message:M.humanLoginMessage(result),makeeduLogin:{running:false,result,blocked}});
  assert.match(ui.el('makeedu-login-state').textContent,/'연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장하면 풀립니다/);
  assert.match(ui.el('message').textContent,/^다시 로그인되었습니다 — aywa의 '지금 동기화'로 바로 가져올 수 있습니다\. 다만 비밀번호 확인 멈춤은 남아/);
  assert.match(ui.el('message').textContent,/'연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장해 주세요/);
  ui.render({...base,makeeduLogin:{running:false,result:null,blocked:blockedState('NO_CHK')}});
  assert.match(ui.el('makeedu-login-state').textContent,/^자동 로그인 멈춤 · 인증정보가 올바르지 않습니다 .* 비밀번호를 확인해 다시 저장하면 풀립니다/);
});

test('계정 계열 멈춤 — 원인 + makeedu에서 해결한 뒤 비밀번호 한 번 더 저장(같은 값이어도) · 읽지 못한 기록 · 예비 표시 경고',()=>{
  const ui=mount();
  const want={NOK:'계정이 미인증 상태입니다',NO_PASS:'호출정보가 올바르지 않습니다',NO_PTYPE:'무료형·실속형(라이트) 사용자로 안내됩니다',NOK_LIMIT:'사용 기한·결제 화면으로 안내됩니다',SOMETHING_NEW:'알 수 없는 응답(SOMETHING_NEW)'};
  for(const [code,what] of Object.entries(want)){
    ui.render({...base,makeeduLogin:{running:false,result:null,blocked:blockedState(code)}});
    assert.equal(ui.el('makeedu-login-state').textContent,
      `자동 로그인 멈춤 · ${what} (11월 6일 06:00부터) — makeedu에서 해결한 뒤 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면(같은 값이어도) 자동 로그인을 다시 시도합니다.`,code);
  }
  // 멈춤 기록을 읽지 못함 — makeedu에서 해결할 일이 아니다(재리뷰 경미 4)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-ui-makeedu-broken-'));
  try{const f=path.join(root,'makeedu','login-blocked.json');fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'{깨짐');
    ui.render({...base,makeeduLogin:{running:false,result:null,blocked:M.readLoginBlock(root)}});}
  finally{fs.rmSync(root,{recursive:true,force:true});}
  assert.equal(ui.el('makeedu-login-state').textContent,
    "자동 로그인 멈춤 · 동기화 PC의 멈춤 기록을 읽지 못했습니다 — 안전을 위해 멈춰 두었습니다 · 관리 코드로 설정을 연 '연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면(같은 값이어도) 다시 시도합니다.");
  // 기록 파일을 열 수 없음(읽기 자체 실패 — EISDIR로 흉내 · fix4) — 비밀번호 저장으로 안 풀리므로 그 안내 없이
  const root2=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-ui-makeedu-locked-'));
  try{fs.mkdirSync(path.join(root2,'makeedu','login-blocked.json'),{recursive:true});
    ui.render({...base,makeeduLogin:{running:false,result:null,blocked:M.readLoginBlock(root2)}});}
  finally{fs.rmSync(root2,{recursive:true,force:true});}
  assert.equal(ui.el('makeedu-login-state').textContent,
    "자동 로그인 멈춤 · 동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등) — 안전을 위해 멈춰 두었습니다 · 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요(파일을 다시 읽을 수 있으면 원래 상태로 돌아갑니다).");
  assert.doesNotMatch(ui.el('makeedu-login-state').textContent,/비밀번호|연동 계정/);
  ui.render({...base,makeeduLogin:{running:false,result:null,blocked:{...blockedState('NO_LOGIN_CNT'),fallback:true}}});
  assert.match(ui.el('makeedu-login-state').textContent,/⚠️ 멈춤 표시를 예비 파일에 남겼습니다\(본 파일 저장 실패 — 로그 폴더를 확인해 주세요\)\.$/);
});

test('직전 다시 로그인이 makeedu 쪽에서 막혔으면(headless 재사용 거절·풀었는데 거절) — 칸 안내도 "makeedu 문의"',()=>{
  const ui=mount();
  for(const code of ['HEADLESS_REJECTED','CAPTCHA_REJECTED']){
    const result={ok:false,code};
    ui.render({...base,message:M.humanLoginMessage(result),makeeduLogin:{running:false,result,blocked:blockedState('CAPTCHA_REQUIRED')}});
    assert.match(ui.el('makeedu-login-state').textContent,/— 'makeedu 다시 로그인'으로는 풀리지 않았습니다 — makeedu 문의가 필요합니다\(위 안내 참고\)\.$/,code);
    assert.match(ui.el('message').textContent,/makeedu 문의가 필요합니다/,code);
  }
  // 그 밖의 실패(시간 초과 등)는 지금처럼 다시 누르기
  ui.render({...base,makeeduLogin:{running:false,result:{ok:false,code:'TIMEOUT'},blocked:blockedState('CAPTCHA_REQUIRED')}});
  assert.match(ui.el('makeedu-login-state').textContent,/'makeedu 다시 로그인'을 눌러 주세요\.$/);
});

test('창이 열린 동안 — 비밀번호·계정 멈춤이면 "저장된 비밀번호는 채우지 않았습니다 — 직접 입력" · 잠금이면 직접 입력 · 채웠으면 말 없음',()=>{
  const ui=mount();
  const run=(note,blocked=null)=>{ui.render({...base,makeeduLogin:{running:true,passwordNote:note,result:null,blocked}});return ui.el('makeedu-login-state').textContent;};
  assert.match(run('blocked',blockedState('NO_LOGIN_CNT',{remaining:2})),/자동 로그인 멈춤\(비밀번호·계정 확인\) 중이라 저장된 비밀번호는 채우지 않았습니다 — 비밀번호를 직접 입력해 주세요\. 로그인 버튼과 사람 확인은/);
  assert.match(run('locked'),/비밀번호는 직접 입력해 주세요\. 로그인 버튼과 사람 확인은/);
  assert.doesNotMatch(run('filled'),/직접 입력/);
});

test('멈춤 없음 · 창 열림 — 안내 줄 숨김 / 창이 열린 동안 버튼 잠김 · 버튼은 makeedu-login 명령',async()=>{
  const ui=mount();
  await new Promise(r=>setImmediate(r)); // 시작 때 'state' 명령이 끝나야 버튼 잠금이 풀린다(실제 앱과 같음)
  ui.render({...base,message:M.humanLoginMessage({ok:true,code:'OK'})});
  assert.equal(ui.el('makeedu-login-state').hidden,true);
  assert.equal(ui.el('message').textContent,"다시 로그인되었습니다 — aywa의 '지금 동기화'로 바로 가져올 수 있습니다");
  assert.equal(ui.el('makeedu-login').disabled,false);
  ui.render({...base,makeeduLogin:{running:true,result:null,blocked:blockedState('CAPTCHA_REQUIRED')}});
  assert.equal(ui.el('makeedu-login').disabled,true);
  assert.match(ui.el('makeedu-login-state').textContent,/^로그인 창이 열려 있습니다/);
  ui.render(base);
  for(const fn of ui.el('makeedu-login').listeners.click??[])fn();
  await new Promise(r=>setImmediate(r));
  assert.ok(ui.calls.includes('makeedu-login'));
});
