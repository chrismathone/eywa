// 업데이트 준비 진행률(1.0.18) — 실제 ui/app.js를 작은 DOM 대역 위에서 돌린다(npm test가 화면 갈래를 직접 지킨다 · 1.0.18 리뷰 경미 3).
// 지키는 것: 복사·압축 해제는 용량(MB)으로 세고 파일 수도 함께 · 앞 단계 값이 남은 다른 단계와 용량 없는 옛 값은 종전대로 · 막대 값 = 문구의 퍼센트.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8');
const MB=1024*1024;

function element(id){
  return{id,textContent:'',hidden:false,disabled:false,value:'',checked:false,className:'',min:'',listeners:{},
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);},append(){},reset(){}};
}
function mount(){
  const els=new Map();const get=id=>{if(!els.has(id))els.set(id,element(id));return els.get(id);};
  let onState=null;
  const document={getElementById:get,createElement:()=>element(''),createTextNode:t=>({t}),querySelectorAll:()=>[]};
  const window={agent:{command:async()=>({ok:true}),onState:fn=>{onState=fn;return()=>{};}}};
  vm.runInNewContext(APP,{document,window,FormData:class{},console});
  return{render:state=>onState(state),el:get};
}
const base={version:'1.0.18',tenantName:'시험 지점',paired:true,revoked:false,online:true,unlocked:false,
  local:{autoStart:true,startMinimized:false,paused:false,classnoteEnabled:true,makeeduEnabled:true,autoDownload:true},
  configuration:{cutoverReady:true,enabled:true,updatesEnabled:true},modules:{classnote:'running',makeedu:'running'},update:'downloading',message:'',
  activity:[],credentials:{},events:[],makeeduLogin:{running:false,result:null,blocked:null}};
function show(ui,progress){
  ui.render({...base,updateInfo:{ready:null,plan:null,progress,pending:true,failure:null,checkedAt:null,closing:false,applyStep:null,justUpdated:null}});
  const text=ui.el('update-progress-text').textContent,bar=ui.el('update-progress').value;
  const shown=/ · (\d+)%$/.exec(text);
  if(shown)assert.equal(String(bar),shown[1],`막대 값과 문구의 퍼센트가 같아야 한다: ${text}`);
  return{state:ui.el('update-state').textContent,text,bar,hidden:ui.el('update-progress-wrap').hidden};
}

test('복사·압축 해제 = 용량(MB) + 파일 수 · 퍼센트는 둘의 평균(원장 화면 "67 / 10,021개 파일 · 0%" → 11% · 2026-11-09)',()=>{
  const ui=mount();
  let r=show(ui,{phase:'copying',completed:67,total:10021,bytes:348*MB,totalBytes:1521*MB,version:'1.0.19'});
  assert.deepEqual(r,{state:'그대로 쓸 파일 복사 중',text:'348.0 / 1,521.0 MB · 67 / 10,021개 파일 · 11%',bar:11,hidden:false});
  // 큰 파일이 앞에 몰린 모양(파일 10% · 용량 82%) — 용량만이면 81%, 평균이면 45%(80%대에 오래 머물지 않는다)
  assert.equal(show(ui,{phase:'copying',completed:1002,total:10021,bytes:1247*MB,totalBytes:1521*MB,version:'1.0.19'}).bar,45);
  // 파일은 반인데 용량은 거의 끝 — 평균이라 92%에 붙지 않는다
  assert.equal(show(ui,{phase:'copying',completed:5010,total:10021,bytes:1400*MB,totalBytes:1521*MB,version:'1.0.19'}).bar,71);
  r=show(ui,{phase:'copying',completed:0,total:10021,bytes:0,totalBytes:1521*MB,version:'1.0.19'});
  assert.equal(r.text,'0.0 / 1,521.0 MB · 0 / 10,021개 파일 · 0%');
  r=show(ui,{phase:'copying',completed:10021,total:10021,bytes:1521*MB,totalBytes:1521*MB,version:'1.0.19'});
  assert.equal(r.text,'1,521.0 / 1,521.0 MB · 10,021 / 10,021개 파일 · 100%');
  r=show(ui,{phase:'extracting',completed:0,total:10021,bytes:0,totalBytes:1521*MB,version:'1.0.19'});
  assert.deepEqual(r,{state:'압축 해제 · 파일 검증 중',text:'0.0 / 1,521.0 MB · 0 / 10,021개 파일 · 0%',bar:0,hidden:false});
  r=show(ui,{phase:'extracting',completed:67,total:10021,bytes:348*MB,totalBytes:1521*MB,version:'1.0.19'});
  assert.equal(r.text,'348.0 / 1,521.0 MB · 67 / 10,021개 파일 · 11%');
});

test('용량 없는 옛 값 · 전체 크기 0 → 종전처럼 파일 수',()=>{
  const ui=mount();
  assert.equal(show(ui,{phase:'copying',completed:67,total:10021,version:'1.0.19'}).text,'67 / 10,021개 파일 · 0%');
  assert.equal(show(ui,{phase:'extracting',completed:1250,total:10000,version:'1.0.19'}).text,'1,250 / 10,000개 파일 · 12%');
  assert.equal(show(ui,{phase:'copying',completed:1,total:2,bytes:0,totalBytes:0,version:'1.0.19'}).text,'1 / 2개 파일 · 50%');
});

test('앞 단계(복사)의 bytes·totalBytes가 남은 다운로드·마무리는 그 단계 값으로(진행 값은 합쳐진다)',()=>{
  const ui=mount();
  const left={bytes:1521*MB,totalBytes:1521*MB};
  let r=show(ui,{phase:'downloading',completed:3*MB,total:12*MB,files:5,...left,version:'1.0.19'});
  assert.deepEqual(r,{state:'다운로드 중',text:'3.0 / 12.0 MB · 25%',bar:25,hidden:false});
  r=show(ui,{phase:'finalizing',completed:10021,total:10021,files:0,...left,version:'1.0.19'});
  assert.deepEqual(r,{state:'설치 준비 마무리 중',text:'10,021 / 10,021개 파일 · 100%',bar:100,hidden:false});
  r=show(ui,{phase:'verifying',completed:570*MB,total:570*MB,...left,version:'1.0.19'});
  assert.equal(r.text,'570.0 / 570.0 MB · 100%');
  assert.equal(show(ui,{phase:'downloading',completed:1234.5*MB,total:1521*MB,version:'1.0.19'}).text,'1,234.5 / 1,521.0 MB · 81%'); // 다운로드 MB도 천 단위(재리뷰)
});

test('진행 값 없음 · 확인 중 → 막대 숨김',()=>{
  const ui=mount();
  assert.equal(show(ui,null).hidden,true);
  assert.equal(show(ui,null).text,'');
  const r=show(ui,{phase:'checking',completed:0,total:0});
  assert.equal(r.hidden,true);assert.equal(r.state,'새 버전 확인 중');
});
