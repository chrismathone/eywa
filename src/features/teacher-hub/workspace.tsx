"use client";
import { EmbedLink as Link,EmbedHiddenInput } from "@/components/embed-link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { capacityRemaining,type TeacherHub,type RecordKind } from "./model";
import a from "@/components/analytics/analytics.module.css";
import s from "./workspace.module.css";
import { TeacherVisuals } from "./visuals";

const recordLabels:Record<RecordKind,string>={report:"수업보고",sheet:"영어 개별 시트",consultation:"상담",promise:"약속 이행",marketing:"행사 초대·참석",work:"업무문서"};
const number=(n:number)=>n.toLocaleString("ko-KR",{maximumFractionDigits:1});
export function TeacherHubWorkspace({data}:{data:TeacherHub}){
  const [recordKind,setRecordKind]=useState<RecordKind>("report"),[limit,setLimit]=useState(50),[metricId,setMetricId]=useState("churn");
  const names=new Map(data.students.map(x=>[x.id,x.name]));
  const currentIds=new Set(data.enrollments.map(e=>e.studentId));
  const currentStudents=data.students.filter(x=>currentIds.has(x.id));
  const rows=data.records.filter(r=>r.kind===recordKind);
  const evidence=data.graph.nodes.filter(n=>n.kind==="snapshot_evidence"&&String(n.id).includes(`:${data.month}:${metricId}:`));
  const groups=[
    {title:"담당 학생·반",value:`${currentStudents.length}명 · ${data.classes.length}개 반`,href:"#roster",state:true},
    {title:"시트·수업·상담 기록",value:`${data.records.filter(r=>["report","sheet","consultation"].includes(r.kind)).length}건`,href:"#records",state:data.coverage.filter(c=>["report","sheet","consultation"].includes(c.key)).every(c=>c.state==="ready")},
    {title:"약속·실행 증거",value:`${data.records.filter(r=>r.kind==="promise").length}건`,href:"#records",state:data.coverage.find(c=>c.key==="promise")?.state==="ready"},
    {title:"퇴원·성적·만족도",value:`${data.metrics.filter(m=>m.state==="ready").length}개 실측 지표`,href:"#performance",state:!!data.computedAt},
    {title:"행사·업무 기록",value:`${data.records.filter(r=>r.kind==="marketing"||r.kind==="work").length}건`,href:"#records",state:data.coverage.filter(c=>["marketing","work"].includes(c.key)).every(c=>c.state==="ready")},
    {title:"급여비율·배정 여력",value:data.capacity?`상한 ${data.capacity.max_students}명`:"배정 상한 입력 가능",href:"#capacity",state:data.capacityReady},
  ];
  return <main className={`${s.main} ${a.dashboard}`}>
    <header className={s.hero}><div><Link href="/class-review">← 수업 평가</Link><p className={s.eyebrow}>수업 평가 · 강사 지식그래프</p><h1>강사 기록이 근거로 이어지는 곳</h1><p>담당 학생부터 수업·상담·약속·성과·배정 여력까지, 같은 강사ID로 확인합니다.</p></div>
      <form action="/class-review/knowledge" className={s.filters}><EmbedHiddenInput/><label>강사<select name="teacher" defaultValue={data.teacher.id}>{data.teachers.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>성과 분석 월<select name="month" defaultValue={data.month}>{data.months.map(m=><option key={m} value={m}>{m}</option>)}</select></label><button type="submit">조회</button></form>
    </header>
    <nav className={s.nav} aria-label="강사 연결 메뉴"><a href="#graph">지식그래프</a><a href="#roster">담당 학생·반</a><a href="#records">원본 기록</a><a href="#performance">성과와 근거</a><a href="#capacity">학생 배정 여력</a><Link href={`/class-review?tab=portfolio&teacher=${data.teacher.id}`}>포트폴리오·지금 집계 ↗</Link></nav>
    <TeacherVisuals data={data}/>
    <section id="graph" className={s.panel}><div className={s.heading}><div><p className={s.eyebrow}>CONNECTED EVIDENCE</p><h2>{data.teacher.name} 강사 지식그래프</h2></div><a href={`/api/teachers/${data.teacher.id}/knowledge?month=${data.month}`} download>근거 포함 그래프 JSON ↓</a></div>
      <div className={s.graph}><div className={s.root}><strong>{data.teacher.name}</strong><span>강사ID를 기준으로 연결</span><small>현재 업무 {data.today}<br/>저장 성과 {data.month}</small></div><div className={s.branches}>{groups.map(g=><a key={g.title} href={g.href} className={g.state?s.connected:s.pending}><span>{g.title}</span><strong>{g.value}</strong><small>{g.state?"관계 조회 연결됨":"연결 상태 확인 필요"}</small></a>)}</div></div>
      <p className={s.note}>실선은 실제 조회 경로가 연결된 관계입니다. 0건은 해당 범위의 기록이 없는 상태이며, 조회 실패·미입력·과거 추정은 별도로 표시합니다.</p>
    </section>
    <section className={s.insights}><h2>함께 판단할 사항</h2>{data.insights.length?<ul>{data.insights.map(n=><li key={n}>{n}</li>)}</ul>:<p>저장된 지표와 담당 기준이 모이면 판단할 사항을 표시합니다.</p>}</section>
    <section id="roster" className={s.panel}><div className={s.heading}><h2>현재 담당 학생·반</h2><span>{data.today} 기준 · 과거 성과에 소급하지 않음</span></div><div className={s.kpis}><div><span>중복 제거 담당 학생</span><strong>{currentStudents.length}명</strong></div><div><span>담당 반</span><strong>{data.classes.length}개</strong></div><div><span>학생×반 수강 관계</span><strong>{data.enrollments.length}건</strong></div></div>
      <div className={s.classGrid}>{data.classes.map(c=><article key={c.id}><h3>{c.name}</h3><p>{c.assignment} · {c.subject}</p><div>{[...new Set(data.enrollments.filter(e=>e.classId===c.id).map(e=>e.studentId))].map(id=><Link key={id} href={`/students/${id}/hub`}>{names.get(id)??"학생"}</Link>)}</div></article>)}</div>{!data.classes.length?<p>기준일에 담당하는 반이 없습니다.</p>:null}
    </section>
    <section id="records" className={s.panel}><div className={s.heading}><h2>작성·이행 기록에서 원본까지</h2><span>약속은 현재 전체 / 나머지는 {data.month}</span></div><div className={s.tabs}>{(Object.entries(recordLabels) as [RecordKind,string][]).map(([key,label])=><button key={key} type="button" aria-pressed={key===recordKind} onClick={()=>{setRecordKind(key);setLimit(50);}}>{label} {data.records.filter(r=>r.kind===key).length}</button>)}</div>
      <p className={s.note}>{data.coverage.find(c=>c.key===recordKind)?.note}</p><div className={s.scroll}><table><thead><tr><th>일자 / 약속 기한</th><th>학생</th><th>기록</th><th>상태</th><th>근거</th></tr></thead><tbody>{rows.slice(0,limit).map(r=><tr key={`${r.source}:${r.id}`}><td>{r.date??"—"}</td><td>{r.studentId?<Link href={`/students/${r.studentId}/hub`}>{names.get(r.studentId)}</Link>:"—"}</td><td><Link href={r.href}>{r.label}</Link>{r.note?<small>{r.note}</small>:null}</td><td>{r.state??"기록됨"}</td><td>{r.evidence?.map(e=><Link key={`${e.source}:${e.id}`} href={e.href}>이행 증거 ↗ </Link>)}<small>{r.source} · {r.id}</small></td></tr>)}</tbody></table></div>{!rows.length?<p>이 범위에 표시할 기록이 없습니다. 위 연결 상태를 함께 확인하세요.</p>:null}{rows.length>limit?<button type="button" onClick={()=>setLimit(n=>n+50)}>50건 더 보기</button>:null}
    </section>
    <section id="performance" className={s.panel}><div className={s.heading}><h2>{data.month} 성과와 원본 근거</h2><span>{data.closing} · {data.computedAt?new Date(data.computedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"저장 집계 없음"}</span></div>
      <div className={s.metrics}>{data.metrics.map(m=><article key={m.id}><div><span>{m.label}</span><small>{m.dataMonth} 자료</small></div><strong>{m.raw===null?m.state==="estimated"?"과거 추정":"자료 확인":`${number(m.raw)}${m.unit}`}</strong><p>{m.basis}</p>{m.context.map(t=><small key={t}>{t}</small>)}<small>{m.reason}</small><button type="button" onClick={()=>setMetricId(m.id)}>연결 근거 {m.rowCount}행 보기</button></article>)}</div>
      {!data.metrics.length?<p>해당 월 집계가 없습니다. 포트폴리오의 ‘지금 집계’를 실행하면 이곳에서도 조회합니다.</p>:null}
      <details className={s.evidence} open><summary>{data.metrics.find(m=>m.id===metricId)?.label??"지표"}의 연결 근거 · 최대 120행</summary><div className={s.evidenceGrid}>{evidence.map(n=><article key={n.id}><Link href={n.href??"/class-review?tab=portfolio"}>{n.label} · 원본 학생/포트폴리오 ↗</Link><pre>{JSON.stringify(n.attributes,null,2)}</pre></article>)}</div>{!evidence.length?<p>연결 가능한 상세 근거가 없습니다. 원본 포트폴리오에서 산식·자료 상태를 확인해 주세요.</p>:null}</details>
      <h3>성적 분포와 동일 학생의 관측 변화</h3><p>아래 분포는 확인테스트·내신·기타 시험 점수율을 시험 건수로 가중 평균합니다. 종류별 점수가 없는 {data.grades.excludedDistribution}명은 분포에서 제외합니다. 제출률·응시율을 포함한 성적관리 지표와 구분하며, 시험 난도·입학 수준을 보정한 강사 효과가 아닙니다.</p>
      <div className={s.kpis}>{data.grades.distribution.map(bin=><div key={bin.label}><span>{bin.label}</span><strong>{bin.count}명</strong></div>)}</div><p>전월과 같은 학생·시험 종류의 관측 {data.grades.pairs.length}쌍 · 평균 변화 {data.grades.averageChange===null?"비교 자료 없음":`${number(data.grades.averageChange)}%p`}</p>
      <details><summary>비교 학생·시험 종류 확인</summary><div className={s.scroll}><table><thead><tr><th>학생</th><th>시험 종류</th><th>전월</th><th>선택 월</th><th>변화</th></tr></thead><tbody>{data.grades.pairs.map(p=><tr key={`${p.studentId}:${p.kind}`}><td><Link href={`/students/${p.studentId}/hub`}>{names.get(p.studentId)??"학생"}</Link></td><td>{({check:"확인테스트",school:"내신",other:"기타"})[p.kind]??p.kind}</td><td>{number(p.before)}%</td><td>{number(p.after)}%</td><td>{number(p.change)}%p</td></tr>)}</tbody></table></div></details>
    </section>
    <section id="capacity" className={s.panel}><h2>현재 학생 배정 여력</h2><p>관리자가 {data.today.slice(0,7)}의 적정 담당 학생 수를 정하면, 현재 중복 제거 담당 학생 수와 비교합니다. 시간표·수준·업무 부담을 검토한 근거를 함께 남겨 주세요.</p><CapacityForm key={`${data.teacher.id}:${data.capacity?.version??0}`} data={data} students={currentStudents.length}/></section>
    <section className={s.panel}><h2>연결 범위와 최신성</h2><div className={s.scroll}><table><thead><tr><th>자료</th><th>상태</th><th>건수</th><th>범위</th></tr></thead><tbody>{data.coverage.map(c=><tr key={c.key}><td>{c.label}</td><td>{c.state==="ready"?"조회 연결됨":c.state==="forbidden"?"열람 권한 필요":"조회 확인 필요"}</td><td>{c.count??"미확인"}</td><td>{c.note}</td></tr>)}</tbody></table></div><p className={s.note}>행사 입력자는 기록을 작성한 사람입니다. 참석·등록이 해당 강사의 단독 성과라는 뜻은 아닙니다. 모든 기간의 원본이 이 그래프에 들어온 것은 아닙니다.</p></section>
  </main>;
}

function CapacityForm({data,students}:{data:TeacherHub;students:number}){
  const router=useRouter(),[max,setMax]=useState(data.capacity?String(data.capacity.max_students):""),[basis,setBasis]=useState(data.capacity?.basis??""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function save(event:React.FormEvent){
    event.preventDefault();setBusy(true);setMessage("");
    try{
      const res=await fetch("/api/teachers/capacity",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({teacherId:data.teacher.id,month:data.today.slice(0,7),version:data.capacity?.version??0,requestId:crypto.randomUUID(),maxStudents:max===""?null:Number(max),basis})});
      const body=await res.json().catch(()=>({}));if(!res.ok)throw Error(body.error??"저장하지 못했습니다");
      setMessage("배정 기준과 변경 이력을 저장했습니다.");router.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:"저장하지 못했습니다");}finally{setBusy(false);}
  }
  const locked=!data.canWrite||!data.capacityReady||busy;
  const remaining=capacityRemaining(data.capacity,students);
  return <form onSubmit={save} className={s.capacity}><div className={s.kpis}><div><span>현재 담당</span><strong>{students}명</strong></div><div><span>저장된 상한</span><strong>{data.capacity?`${data.capacity.max_students}명`:"입력 전"}</strong></div><div><span>상한 대비 여력</span><strong>{remaining===null?"기준 입력 후":`${remaining}명`}</strong></div></div><label>적정 담당 학생 수 (0명은 추가 배정 중지)<input type="number" min="0" max="2000" step="1" required value={max} onChange={e=>setMax(e.target.value)} disabled={locked}/></label><label>판단 근거·적용 조건<textarea required minLength={2} maxLength={1500} value={basis} onChange={e=>setBasis(e.target.value)} placeholder="과목·학년·반 정원·상담 부담·시간표를 고려한 근거" disabled={locked}/></label><button disabled={locked}>{busy?"저장 중…":"배정 기준 저장"}</button><p role="status">{message}</p>{data.capacity?<small>v{data.capacity.version} · {new Date(data.capacity.updated_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})} 저장</small>:null}</form>;
}
