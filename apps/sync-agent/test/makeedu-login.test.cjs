// 메이크에듀 '다시 로그인'(2026-11-06) — 앱 쪽 실행 환경·결과 문구·멈춤 표시 읽기. 브라우저·네트워크·makeedu 없음.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const M=require('../lib/makeedu-login.cjs');

test('모듈(supervisor)과 같은 세션 파일·브라우저 폴더를 쓴다',()=>{
  const stateRoot=path.join('C:','fixture','tenants','t1','state');
  assert.equal(M.makeeduSessionFile(stateRoot),path.join(stateRoot,'makeedu','session.json'));
  const supervisor=fs.readFileSync(path.join(__dirname,'../lib/supervisor.cjs'),'utf8');
  assert.ok(supervisor.includes('MAKEEDU_SESSION_FILE:makeeduSessionFile(this.stateRoot)'),'supervisor가 같은 함수를 쓴다');
  assert.ok(supervisor.includes("PLAYWRIGHT_BROWSERS_PATH:path.join(this.resources,'browsers')"));
  const env=M.humanLoginEnv({baseEnv:{},resources:path.join('C:','res'),stateRoot,credentials:{}});
  assert.equal(env.MAKEEDU_SESSION_FILE,path.join(stateRoot,'makeedu','session.json'));
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,path.join('C:','res','browsers'));
  assert.equal(env.ELECTRON_RUN_AS_NODE,'1');
});

test('사람 로그인 환경 — makeedu 아이디만, 비밀번호는 설정이 열렸을 때만 · DB·중계·다른 계정·개발 비밀은 넘기지 않는다',()=>{
  const baseEnv={PATH:'C:\\bin',TEMP:'C:\\t',DATABASE_URL:'postgres://secret',SUPABASE_SERVICE_ROLE_KEY:'k',MAKEEDU_PW:'from-shell'};
  const credentials={MAKEEDU_ID:'fixture-id',MAKEEDU_PW:'fixture-pw',CLASSNOTE_UPLOAD_ID:'cn',CLASSNOTE_UPLOAD_PW:'cnpw',GOOGLE_DRIVE_REFRESH_TOKEN:'g'};
  const locked=M.humanLoginEnv({baseEnv,resources:'R',stateRoot:'S',credentials,includePassword:false});
  assert.equal(locked.MAKEEDU_ID,'fixture-id');assert.equal(locked.MAKEEDU_PW,undefined);
  assert.equal(locked.PATH,'C:\\bin');assert.equal(locked.TEMP,'C:\\t');
  for(const key of ['DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CLASSNOTE_UPLOAD_ID','CLASSNOTE_UPLOAD_PW','GOOGLE_DRIVE_REFRESH_TOKEN','SYNC_AGENT_BROKER_TOKEN','SYNC_AGENT_MODE'])assert.equal(locked[key],undefined,key);
  const unlocked=M.humanLoginEnv({baseEnv,resources:'R',stateRoot:'S',credentials,includePassword:true});
  assert.equal(unlocked.MAKEEDU_PW,'fixture-pw');
  assert.equal(M.humanLoginEnv({baseEnv,resources:'R',stateRoot:'S',credentials:{},includePassword:true}).MAKEEDU_PW,undefined,'셸의 값을 물려받지 않는다');
});

test('결과 줄 해석 — 마지막 결과 줄과 끝 코드가 함께 성공이어야 성공',()=>{
  const line=r=>`${M.RESULT_TAG}${JSON.stringify(r)}`;
  assert.deepEqual(M.parseHumanLoginOutput(`안내\n${line({ok:true,code:'OK'})}\n`,0),{ok:true,code:'OK',last:null});
  assert.equal(M.parseHumanLoginOutput(line({ok:true,code:'OK'}),1).ok,false,'끝 코드가 실패면 실패');
  assert.deepEqual(M.parseHumanLoginOutput(line({ok:false,code:'TIMEOUT',last:{code:'NO_LOGIN_CNT',remaining:2}}),1),{ok:false,code:'TIMEOUT',last:{code:'NO_LOGIN_CNT',remaining:2,captchaToken:false}});
  // headless 재사용 확인 결과·진단(캡차 토큰 유무)만 싣는다 — 이상한 값·그 밖의 칸은 버린다
  assert.deepEqual(M.parseHumanLoginOutput(line({ok:true,code:'OK',headless:'unknown'}),0),{ok:true,code:'OK',headless:'unknown',last:null});
  assert.equal(M.parseHumanLoginOutput(line({ok:true,code:'OK',headless:'<x>'}),0).headless,undefined);
  assert.deepEqual(M.parseHumanLoginOutput(line({ok:false,code:'CAPTCHA_REJECTED',last:{code:'CAPTCHA_REQUIRED',remaining:null,captchaToken:true,runtime:'automation',token:'SECRET'}}),1),
    {ok:false,code:'CAPTCHA_REJECTED',last:{code:'CAPTCHA_REQUIRED',remaining:null,captchaToken:true}});
  assert.deepEqual(M.parseHumanLoginOutput('결과 줄 없음',0),{ok:false,code:'ERROR',last:null},'저장을 확인 못 했으면 성공으로 보지 않는다');
  assert.equal(M.parseHumanLoginOutput('',null).code,'LAUNCH_FAILED');
  assert.equal(M.parseHumanLoginOutput(line({ok:false,code:'<script>'}),1).code,'ERROR');
  assert.equal(M.parseHumanLoginOutput(`${line({ok:false,code:'CLOSED'})}\n${line({ok:true,code:'OK'})}`,0).code,'OK','마지막 줄이 이긴다');
});

test('화면 문구 — 성공은 정해진 문구 · 실패는 사유와 다시 누를 안내 · 개인정보 없음',()=>{
  assert.equal(M.humanLoginMessage({ok:true,code:'OK'}),"다시 로그인되었습니다 — aywa의 '지금 동기화'로 바로 가져올 수 있습니다");
  assert.match(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:null}),/^5분 안에 로그인을 마치지 못해 창을 닫았습니다\. 다시 'makeedu 다시 로그인'/);
  assert.match(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:{code:'NO_LOGIN_CNT',remaining:3}}),/마지막 makeedu 응답: 로그인 정보가 올바르지 않음 · 남은 시도 3회/);
  assert.match(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:{code:'NOK',remaining:null}}),/마지막 makeedu 응답: 계정이 미인증 상태입니다/);
  assert.match(M.humanLoginMessage({ok:false,code:'CLOSED',last:{code:'CAPTCHA_REQUIRED',remaining:null}}),/로그인 창이 닫혀.*사람 확인 필요/);
  assert.match(M.humanLoginMessage({ok:false,code:'LAUNCH_FAILED'}),/브라우저\)을 열지 못했습니다/);
  assert.match(M.humanLoginMessage({ok:false,code:'SAVE_FAILED'}),/저장하지 못했습니다/);
  assert.match(M.humanLoginMessage({ok:false,code:'ERROR'}),/마치지 못했습니다/);
  assert.equal(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:{code:'<b>',remaining:null}}).includes('<b>'),false);
  // 리뷰 13·14 — makeedu 쪽에서 막힌 두 경우는 다시 누르라고 하지 않고 makeedu 문의를 안내
  assert.equal(M.humanLoginMessage({ok:false,code:'HEADLESS_REJECTED',headless:'dead'}),'사람 로그인은 됐지만 자동 실행에서 그 세션을 쓸 수 없습니다(makeedu가 브라우저를 바꾼 세션을 막는 것으로 보임) — makeedu 문의가 필요합니다. 자동 로그인 멈춤은 그대로입니다.');
  assert.equal(M.humanLoginMessage({ok:false,code:'CAPTCHA_REJECTED'}),'makeedu가 이 창의 로그인을 받지 않습니다(사람 확인을 마친 제출에도 다시 사람 확인을 요구했습니다) — makeedu 문의가 필요합니다.');
  for(const code of ['HEADLESS_REJECTED','CAPTCHA_REJECTED'])assert.doesNotMatch(M.humanLoginMessage({ok:false,code}),/다시 'makeedu 다시 로그인'을 눌러/,code);
  // 토큰 없는 제출의 CAPTCHA_REQUIRED는 지금 문구(확인 칸을 마친 뒤 다시)
  assert.match(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:{code:'CAPTCHA_REQUIRED',remaining:null,captchaToken:false}}),/사람 확인 필요 — 확인 칸을 마친 뒤 로그인 버튼을 다시 눌러 주세요/);
});

test('자동 로그인 멈춤 표시 읽기 — 자격 지문·원문은 화면에 싣지 않고, 파일이 바뀌면 다시 읽는다',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-login-'));
  try{
    assert.equal(M.readLoginBlock(root),null);
    const file=path.join(root,'makeedu','login-blocked.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,JSON.stringify({code:'CAPTCHA_REQUIRED',message:'원문',at:'2026-11-05T21:00:03.000Z',credHash:'0123456789abcdef'}));
    const a=M.readLoginBlock(root);
    assert.deepEqual(a,{code:'CAPTCHA_REQUIRED',remaining:null,at:'2026-11-05T21:00:03.000Z',family:'human',human:true,fallback:false,reason:'makeedu가 사람 확인을 요구합니다'});
    assert.equal(JSON.stringify(a).includes('0123456789abcdef'),false);
    fs.writeFileSync(file,JSON.stringify({code:'NO_LOGIN_CNT',message:'x',at:'2026-11-06T00:00:00.000Z',credHash:'f',credSalt:'s',remaining:2,extra:'ignored'}));
    const later=new Date(Date.now()+5000);fs.utimesSync(file,later,later);
    assert.equal(M.readLoginBlock(root).reason,'로그인 정보가 올바르지 않습니다 · 남은 시도 2회');
    assert.equal(M.readLoginBlock(root).family,'password');
    fs.writeFileSync(file,'{깨짐');const again=new Date(Date.now()+10000);fs.utimesSync(file,again,again);
    assert.equal(M.readLoginBlock(root).code,'BLOCK_UNREADABLE');assert.equal(M.readLoginBlock(root).family,'account');assert.equal(M.readLoginBlock(root).reason,'동기화 PC의 멈춤 기록을 읽지 못했습니다');
    assert.equal(M.readLoginBlock(root).readError,false,'내용 깨짐');
    // 파일 읽기 자체 실패(EISDIR — 잠김·권한 흉내 · fix4) — 같은 코드·갈래 · 사유만 다르다 · 화면 상태에 readError:true
    fs.rmSync(file);fs.mkdirSync(file);
    const locked=M.readLoginBlock(root);
    assert.deepEqual({code:locked.code,family:locked.family,readError:locked.readError,reason:locked.reason},{code:'BLOCK_UNREADABLE',family:'account',readError:true,reason:'동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등)'});
    assert.deepEqual(M.passwordPrefill({unlocked:true,block:locked}),{include:false,note:'blocked'},'미리 채우기 판정은 그대로');
    fs.rmSync(file,{recursive:true});assert.equal(M.readLoginBlock(root),null,'사람 로그인이 지우면 사라진다');
    // 예비 표시(워커가 본 파일을 못 써서 남긴 것)도 읽고 fallback:true — 화면이 경고를 띄운다
    fs.writeFileSync(path.join(root,'makeedu','login-blocked.alt.json'),JSON.stringify({code:'NO_LOGIN_CNT',at:'2026-11-06T00:00:00.000Z',remaining:1}));
    assert.deepEqual({...M.readLoginBlock(root),reason:undefined},{code:'NO_LOGIN_CNT',remaining:1,at:'2026-11-06T00:00:00.000Z',family:'password',human:false,fallback:true,reason:undefined});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('멈춤 갈래 — 워커(login-guard.cjs)와 같은 표 · 재인증도 사람 확인 · 코드별 사유(makeedu 화면 원문 기준)',()=>{
  const G=require('../../../scripts/_makeedu/login-guard.cjs');
  assert.deepEqual(M.HUMAN_BLOCK_CODES,G.HUMAN_BLOCK_CODES);
  assert.deepEqual(M.PASSWORD_BLOCK_CODES,G.PASSWORD_BLOCK_CODES);
  for(const code of ['CAPTCHA_REQUIRED','NO_REJECT','NO_LOGIN_CNT','NO_CHK','NOK','NO_PASS','NO_PTYPE','NOK_LIMIT','UNKNOWN','BLOCK_UNREADABLE','SOMETHING_NEW'])assert.equal(M.blockFamily(code),G.blockFamily(code),code);
  assert.equal(M.BLOCK_UNREADABLE,G.BLOCK_UNREADABLE);
  for(const code of ['CAPTCHA_REQUIRED','NO_REJECT'])assert.equal(M.isHumanBlock(code),true,code);
  for(const code of ['NO_LOGIN_CNT','NOK','NO_CHK','NO_PASS','NO_PTYPE','NOK_LIMIT','UNKNOWN','BLOCK_UNREADABLE'])assert.equal(M.isHumanBlock(code),false,code);
  const want={CAPTCHA_REQUIRED:'makeedu가 사람 확인을 요구합니다',NO_REJECT:'makeedu가 사람 확인(재인증)을 요구합니다',NO_CHK:'인증정보가 올바르지 않습니다',NOK:'계정이 미인증 상태입니다',
    NO_PASS:'호출정보가 올바르지 않습니다',NO_PTYPE:'무료형·실속형(라이트) 사용자로 안내됩니다',NOK_LIMIT:'사용 기한·결제 화면으로 안내됩니다',SOMETHING_NEW:'알 수 없는 응답(SOMETHING_NEW)',UNKNOWN:'알 수 없는 응답(UNKNOWN)',BLOCK_UNREADABLE:'동기화 PC의 멈춤 기록을 읽지 못했습니다'};
  for(const [code,text] of Object.entries(want))assert.equal(M.blockReason({code}),text,code);
  assert.equal(M.blockReason({code:'NO_LOGIN_CNT',remaining:3}),'로그인 정보가 올바르지 않습니다 · 남은 시도 3회');
  // 읽지 못한 기록 — 읽기 자체 실패 · 내용 깨짐(fix4)
  assert.equal(M.blockReason({code:'BLOCK_UNREADABLE',readError:true}),'동기화 PC의 makeedu 멈춤 기록 파일을 열 수 없습니다(백신·권한·잠금 등)');
  assert.equal(M.blockReason({code:'BLOCK_UNREADABLE',readError:false}),'동기화 PC의 멈춤 기록을 읽지 못했습니다');
});

test('비밀번호 미리 채우기 — 비밀번호·계정 계열(또는 읽지 못한) 멈춤이 있으면 안 채움 · 설정이 잠겨도 안 채움 · 아이디는 늘',()=>{
  assert.deepEqual(M.passwordPrefill({unlocked:true,block:null}),{include:true,note:'filled'});
  assert.deepEqual(M.passwordPrefill({unlocked:false,block:null}),{include:false,note:'locked'});
  assert.deepEqual(M.passwordPrefill({unlocked:true,block:{code:'CAPTCHA_REQUIRED'}}),{include:true,note:'filled'},'사람 확인 멈춤은 비밀번호가 맞다');
  for(const code of ['NO_LOGIN_CNT','NO_CHK','NOK','NO_PASS','NO_PTYPE','NOK_LIMIT','UNKNOWN','BLOCK_UNREADABLE'])
    assert.deepEqual(M.passwordPrefill({unlocked:true,block:{code}}),{include:false,note:'blocked'},code);
  const env=M.humanLoginEnv({baseEnv:{},resources:'R',stateRoot:'S',credentials:{MAKEEDU_ID:'id',MAKEEDU_PW:'pw'},includePassword:M.passwordPrefill({unlocked:true,block:{code:'NO_LOGIN_CNT'}}).include});
  assert.equal(env.MAKEEDU_ID,'id');assert.equal(env.MAKEEDU_PW,undefined);
});

test('연동 계정 저장 — makeedu 비밀번호를 저장할 때만(같은 값이어도) 비밀번호·계정 계열 멈춤을 푼다 · 아이디만 저장은 안 풂',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-save-'));
  const file=path.join(root,'makeedu','login-blocked.json');
  const write=code=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({code,message:'m',at:'2026-11-06T00:00:00.000Z',credSalt:'s',credHash:'h'}));};
  try{
    write('NO_LOGIN_CNT');
    assert.equal(M.credentialsSaved(root,{MAKEEDU_ID:'new-id'}),null);assert.equal(fs.existsSync(file),true,'아이디만 — 그대로');
    assert.equal(M.credentialsSaved(root,{CLASSNOTE_UPLOAD_PW:'x'}),null);assert.equal(fs.existsSync(file),true,'다른 계정 — 그대로');
    assert.equal(M.credentialsSaved(root,{MAKEEDU_PW:''}),null);assert.equal(fs.existsSync(file),true,'빈 값 — 그대로');
    assert.equal(M.credentialsSaved(root,{MAKEEDU_PW:'same-value'}),'NO_LOGIN_CNT');assert.equal(fs.existsSync(file),false,'비밀번호 저장 — 풀림');
    write('NOK');assert.equal(M.credentialsSaved(root,{MAKEEDU_ID:'id',MAKEEDU_PW:'pw'}),'NOK');assert.equal(fs.existsSync(file),false,'계정 계열도 같은 조건');
    write('CAPTCHA_REQUIRED');assert.equal(M.credentialsSaved(root,{MAKEEDU_PW:'pw'}),null);assert.equal(fs.existsSync(file),true,'사람 확인은 비밀번호 저장으로 안 풀림');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('main.cjs 배선 — 창을 열 때 미리 채우기 판단 · 계정 저장 때 비밀번호 저장일 때만 해제',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8');
  assert.ok(main.includes('passwordPrefill({unlocked:Date.now()<unlockedUntil,block:readLoginBlock(tenantStateRoot())})'));
  assert.ok(main.includes('includePassword:prefill.include'));
  assert.ok(main.includes('credentialsSaved(tenantStateRoot(),input)'));
  assert.ok(!main.includes('input.MAKEEDU_ID||input.MAKEEDU_PW'),'아이디 저장만으로 풀던 옛 조건이 없다');
  assert.ok(!/includePassword:Date\.now\(\)<unlockedUntil/.test(main),'잠금만 보던 옛 조건이 없다');
});

test('본·예비 표시 고르기 — 앱 readLoginBlock = 워커 readBlock(같은 파일 묶음으로 맞춘다 · 재리뷰 경미 2)',()=>{
  const G=require('../../../scripts/_makeedu/login-guard.cjs');
  const OLD='2026-11-05T21:00:00.000Z',NEW='2026-11-06T00:00:00.000Z';
  const ok=(code,at)=>JSON.stringify({code,message:'m',at,credSalt:'0'.repeat(32),credHash:'1'.repeat(32),remaining:2});
  // [본, 예비, 기대(코드·예비 여부)] — null = 파일 없음 · 'broken' = 내용 깨짐 · 'dir' = 읽기 오류(EISDIR)
  const cases=[
    [ok('CAPTCHA_REQUIRED',OLD),ok('NO_LOGIN_CNT',NEW),['NO_LOGIN_CNT',true]], // 본이 낡은 채 남고 예비에 새 표시
    [ok('NO_LOGIN_CNT',OLD),ok('CAPTCHA_REQUIRED',NEW),['CAPTCHA_REQUIRED',true]],
    [ok('CAPTCHA_REQUIRED',NEW),ok('NO_LOGIN_CNT',OLD),['CAPTCHA_REQUIRED',false]], // 본이 더 최근
    [ok('NOK',NEW),ok('NO_CHK',NEW),['NOK',false]], // 같으면 본
    [ok('NOK',null),ok('NO_CHK',NEW),['NOK',false]], // 시각 모름이면 본
    [null,ok('NO_LOGIN_CNT',NEW),['NO_LOGIN_CNT',true]],
    [ok('NO_REJECT',NEW),null,['NO_REJECT',false]],
    ['broken',ok('NOK',OLD),['NOK',true]], // 본을 못 읽으면 읽히는 예비
    ['dir',ok('NO_CHK',OLD),['NO_CHK',true]],
    ['broken',null,['BLOCK_UNREADABLE',false]],
    [null,'broken',['BLOCK_UNREADABLE',false]],
    ['broken','broken',['BLOCK_UNREADABLE',false]],
    ['dir',null,['BLOCK_UNREADABLE',false]], // 읽기 실패한 본만 — readError
    ['dir','broken',['BLOCK_UNREADABLE',false]],
    [null,null,null],
  ];
  for(const [i,[main,alt,want]] of cases.entries()){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-pick-'));
    try{
      const dir=path.join(root,'makeedu');fs.mkdirSync(dir,{recursive:true});
      for(const [name,v] of [['login-blocked.json',main],['login-blocked.alt.json',alt]]){
        if(v==null)continue;const f=path.join(dir,name);
        if(v==='dir')fs.mkdirSync(f);else fs.writeFileSync(f,v==='broken'?'{깨짐':v);
      }
      const worker=G.readBlock(path.join(dir,'session.json'));
      const app=M.readLoginBlock(root);
      const w=worker?[worker.code,!!worker.fallback]:null,a=app?[app.code,app.fallback]:null;
      assert.deepEqual(w,want,`워커 ${i}`);assert.deepEqual(a,want,`앱 ${i}`);
      // 읽기 실패 여부도 같다 — 읽기 실패한 본이 골라질 때만(예비가 없거나 예비도 못 읽을 때) true
      const wantRead=main==='dir'&&(alt==null||alt==='broken');
      assert.equal(!!worker?.readError,wantRead,`워커 읽기 실패 ${i}`);assert.equal(!!app?.readError,wantRead,`앱 읽기 실패 ${i}`);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  }
});

test('본(CAPTCHA·옛) + 예비(NO_LOGIN_CNT·새) — 앱·워커가 같은 표시를 보고, 사람 로그인·비밀번호 저장은 파일마다 제 갈래만 지운다(재리뷰 경미 2)',()=>{
  const G=require('../../../scripts/_makeedu/login-guard.cjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-both-'));
  const dir=path.join(root,'makeedu'),sessionFile=path.join(dir,'session.json');
  const main=path.join(dir,'login-blocked.json'),alt=path.join(dir,'login-blocked.alt.json');
  const put=(f,code,at)=>fs.writeFileSync(f,JSON.stringify({code,message:'m',at,credSalt:'0'.repeat(32),credHash:'1'.repeat(32)}));
  const setup=()=>{fs.mkdirSync(dir,{recursive:true});put(main,'CAPTCHA_REQUIRED','2026-11-05T21:00:00.000Z');put(alt,'NO_LOGIN_CNT','2026-11-06T00:00:00.000Z');};
  try{
    setup();
    assert.equal(G.readBlock(sessionFile).code,'NO_LOGIN_CNT');
    const shown=M.readLoginBlock(root);
    assert.equal(shown.code,'NO_LOGIN_CNT');assert.equal(shown.family,'password');assert.equal(shown.fallback,true);
    // 창을 열 때도 같은 표시로 판단 — 비밀번호 멈춤이라 미리 채우지 않는다(예전엔 본(CAPTCHA)을 봐서 채웠다)
    assert.deepEqual(M.passwordPrefill({unlocked:true,block:shown}),{include:false,note:'blocked'});
    // 사람 로그인 성공 — 본(사람 확인)만 지우고 비밀번호 멈춤은 남겨 돌려준다
    assert.equal(G.clearHumanBlock(sessionFile),'NO_LOGIN_CNT');
    assert.deepEqual([fs.existsSync(main),fs.existsSync(alt)],[false,true]);
    assert.equal(M.readLoginBlock(root).code,'NO_LOGIN_CNT');
    // 다시 같은 상황에서 비밀번호 저장 — 예비(비밀번호)만 지우고 본(사람 확인)은 남는다 → 이제 둘 다 사람 확인을 본다
    fs.rmSync(root,{recursive:true,force:true});setup();
    assert.equal(M.credentialsSaved(root,{MAKEEDU_PW:'same-value'}),'NO_LOGIN_CNT');
    assert.deepEqual([fs.existsSync(main),fs.existsSync(alt)],[true,false]);
    assert.equal(M.readLoginBlock(root).code,'CAPTCHA_REQUIRED');assert.equal(G.readBlock(sessionFile).code,'CAPTCHA_REQUIRED');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('멈춤 표시를 읽다 실패(잠김 등)하면 지우지 않는다 · 예비 표시도 함께 푼다',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-ioerr-'));
  const file=path.join(root,'makeedu','login-blocked.json'),alt=path.join(root,'makeedu','login-blocked.alt.json');
  try{
    fs.mkdirSync(file,{recursive:true}); // 읽기 오류 흉내(EISDIR) — ENOENT가 아닌 실패
    assert.equal(M.clearCredentialBlock(root),null);assert.equal(fs.existsSync(file),true,'모르는 표시는 지우지 않는다');
    // 파일마다 따로 — 본을 못 읽어도(남김) 예비의 비밀번호 멈춤은 푼다
    fs.writeFileSync(alt,JSON.stringify({code:'NO_LOGIN_CNT',at:'2026-11-06T00:00:00.000Z'}));
    assert.equal(M.clearCredentialBlock(root),'NO_LOGIN_CNT');assert.equal(fs.existsSync(alt),false,'예비 표시는 푼다');assert.equal(fs.existsSync(file),true,'읽지 못한 본은 남는다');
    fs.rmSync(file,{recursive:true});
    fs.writeFileSync(alt,JSON.stringify({code:'NO_LOGIN_CNT',at:'2026-11-06T00:00:00.000Z'}));
    assert.equal(M.clearCredentialBlock(root),'NO_LOGIN_CNT');assert.equal(fs.existsSync(alt),false,'예비 표시도 푼다');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('연동 계정 다시 저장 — 비밀번호·계정 계열 멈춤만 푼다(같은 값이어도) · 사람 확인 계열은 그대로 · 원문 없음',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aywa-makeedu-cred-'));
  const file=path.join(root,'makeedu','login-blocked.json');
  const write=b=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(b));};
  try{
    assert.equal(M.clearCredentialBlock(root),null,'표시 없음');
    write({code:'CAPTCHA_REQUIRED',message:'m',at:'2026-11-06T00:00:00.000Z',credHash:'abc'});
    assert.equal(M.clearCredentialBlock(root),null);assert.equal(fs.existsSync(file),true,'사람 확인 멈춤은 계정 저장으로 안 풀린다');
    write({code:'NO_REJECT',message:'m',at:'2026-11-06T00:00:00.000Z',credHash:'abc'});
    assert.equal(M.clearCredentialBlock(root),null);assert.equal(fs.existsSync(file),true);
    for(const code of ['NO_LOGIN_CNT','NOK','NO_PASS','NOK_LIMIT']){write({code,message:'m',at:'2026-11-06T00:00:00.000Z',credHash:'abc',remaining:2});
      assert.equal(M.readLoginBlock(root).human,false);
      assert.equal(M.clearCredentialBlock(root),code);assert.equal(fs.existsSync(file),false,code);assert.equal(M.readLoginBlock(root),null);}
    fs.writeFileSync(file,'{깨짐');assert.equal(M.clearCredentialBlock(root),'BLOCK_UNREADABLE');assert.equal(fs.existsSync(file),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('사람 로그인 성공인데 비밀번호·계정 멈춤이 남으면 — 결과에 싣고 화면 문구로 계정 다시 저장을 안내',()=>{
  const r=M.parseHumanLoginOutput(M.RESULT_TAG+JSON.stringify({ok:true,code:'OK',blockKept:'NO_LOGIN_CNT'}),0);
  assert.deepEqual(r,{ok:true,code:'OK',blockKept:'NO_LOGIN_CNT',last:null});
  const text=M.humanLoginMessage(r);
  assert.match(text,/^다시 로그인되었습니다 — aywa의 '지금 동기화'로 바로 가져올 수 있습니다\. 다만 비밀번호 확인 멈춤은 남아/);
  assert.match(text,/'연동 계정'에서 메이크에듀 비밀번호를 확인해 다시 저장해 주세요/);
  const acct=M.humanLoginMessage({ok:true,code:'OK',blockKept:'NOK_LIMIT'});
  assert.match(acct,/다만 계정 확인 멈춤\(사용 기한·결제 화면으로 안내됩니다\)은 남아/);
  assert.match(acct,/makeedu에서 해결한 뒤 .*'연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장해 주세요\(같은 값이어도\)/);
  // 멈춤 기록을 읽지 못해 남긴 경우 — makeedu에서 해결할 일이 아니다(재리뷰 경미 4)
  const unreadable=M.humanLoginMessage({ok:true,code:'OK',blockKept:'BLOCK_UNREADABLE'});
  assert.match(unreadable,/다만 동기화 PC의 멈춤 기록을 읽지 못해 안전을 위해 자동 로그인 멈춤은 남겨 두었습니다/);
  assert.doesNotMatch(unreadable,/makeedu에서 해결/);
  // 실행기 결과엔 코드만 실려 읽기 실패·내용 깨짐을 가를 수 없다 — 두 경우를 함께 안내(fix4)
  assert.match(unreadable,/기록 내용이 깨졌으면 .*'연동 계정'에서 메이크에듀 비밀번호를 한 번 더 저장하면\(같은 값이어도\) 풀리고/);
  assert.match(unreadable,/기록 파일을 열 수 없으면\(백신·권한·잠금\) 동기화 PC를 다시 시작하거나 백신 예외·폴더 권한을 확인해 주세요/);
  assert.equal(M.parseHumanLoginOutput(M.RESULT_TAG+JSON.stringify({ok:true,code:'OK',blockKept:'<x>'}),0).blockKept,undefined,'이상한 코드는 싣지 않는다');
  assert.match(M.humanLoginMessage({ok:false,code:'TIMEOUT',last:{code:'NO_REJECT',remaining:null}}),/재인증 필요 — 재인증 화면까지/);
});

test('보이는 창 실행 — 워커와 같은 WorkerHost로 runtime의 human-login.cjs를 띄우고 결과 줄을 받는다',async()=>{
  const calls=[];let stdinDestroyed=false;
  const spawnImpl=(file,args,options)=>{calls.push({file,args,options});const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),stdin:{destroy(){stdinDestroyed=true;}}});
    setImmediate(()=>{child.stdout.emit('data',Buffer.from(`창 열림\n${M.RESULT_TAG}{"ok":true,"code":"OK"}\n`));child.emit('close',0);});return child;};
  const output=[];
  const result=await new Promise(resolve=>{const run=M.startHumanLogin({resources:path.join('C:','res'),executable:'C:\\app\\AywaSyncRuntime.exe',env:{MAKEEDU_ID:'x'},onOutput:c=>output.push(String(c)),onDone:resolve,spawnImpl});run.stop();});
  assert.deepEqual(result,{ok:true,code:'OK',last:null});
  assert.equal(calls.length,1);
  assert.equal(calls[0].file,path.join('C:','res','WorkerHost.exe'));
  assert.deepEqual(calls[0].args,['C:\\app\\AywaSyncRuntime.exe',path.join('C:','res','runtime','scripts/_makeedu/human-login.cjs')]);
  assert.equal(calls[0].options.cwd,path.join('C:','res','runtime'));
  assert.deepEqual(calls[0].options.env,{MAKEEDU_ID:'x'});
  assert.deepEqual(calls[0].options.stdio,['pipe','pipe','pipe']);
  assert.ok(output.join('').includes('창 열림'));
  assert.equal(stdinDestroyed,true,'stop()은 stdin을 닫아 작업 묶음(창 포함)을 끝낸다');
});

test('실행 자체가 실패하면 LAUNCH_FAILED',async()=>{
  const result=await new Promise(resolve=>M.startHumanLogin({resources:'R',executable:'E',env:{},onDone:resolve,spawnImpl:()=>{throw Error('ENOENT');}}));
  assert.equal(result.code,'LAUNCH_FAILED');
  const viaError=await new Promise(resolve=>M.startHumanLogin({resources:'R',executable:'E',env:{},onDone:resolve,spawnImpl:()=>{const c=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter()});setImmediate(()=>c.emit('error',Error('spawn'))) ;return c;}}));
  assert.equal(viaError.code,'LAUNCH_FAILED');
});
