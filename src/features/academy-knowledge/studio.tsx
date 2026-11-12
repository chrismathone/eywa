"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AcademyKnowledgeData } from "./server";
import { liveHref } from "./routes";
import { blueprint } from "./blueprint";
import { useModuleOn } from "@/features/owner/operations-context";

/** 처음 여는 시트 — 위치 번호가 아니라 id로(리뷰 C11 — 사전에 시트가 끼면 엉뚱한 시트가 열렸다). */
const DEFAULT_SHEET_ID = "10_학생";
import { entities } from "./catalog";
import { expectations, type StudioDocument, type StudioRow, type Expectation } from "./studio-model";
import s from "./studio.module.css";

const labels=Object.fromEntries(entities);
const roleLabels:Record<string,string>={output:"조회·분석",config:"설정",build:"기획·산출",input:"업무 입력",reference:"기준 사전",dictionary:"기준 사전"};
function useVisibleHref() {
  const approvals=useModuleOn("approvals"),classReview=useModuleOn("class_review"),classnote=useModuleOn("classnote"),ecs=useModuleOn("ecs"),mcs=useModuleOn("mcs"),newcomers=useModuleOn("newcomers");
  return (href:string|undefined|null)=>liveHref(href,{approvals,class_review:classReview,classnote,ecs,mcs,newcomers});
}
/** 항목 정의·점검 기준·참고 연결 저장 — 버전을 하나 올려 쌓는다(s2_0051). 성공하면 true(편집 창을 닫는다). */
function useSave(data:AcademyKnowledgeData) {
  const router=useRouter(),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function save(key:string,version:number,document:StudioDocument) {
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/management/model",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key,expectedVersion:version,document,context:{month:data.month,...(data.selectedStudent?{student:data.selectedStudent}:{}),...(data.selectedTeacher?{teacher:data.selectedTeacher}:{})}})});
      const result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error??"저장하지 못했습니다");
      setMessage(`저장했습니다 · 버전 ${result.version}`);router.refresh();return true;
    } catch(e) {setMessage(e instanceof Error?e.message:"저장하지 못했습니다");return false;} finally {setBusy(false);}
  }
  return {save,busy,message};
}
export function StoreNotice({data}:{data:AcademyKnowledgeData}) {return data.studio.error?<p role="alert" className={s.warning}>{data.studio.error}</p>:null;}

export function SchemaTab({data}:{data:AcademyKnowledgeData}) {
  const visibleHref=useVisibleHref();
  const [sheetId,setSheetId]=useState<string>(DEFAULT_SHEET_ID),[search,setSearch]=useState(""),[editing,setEditing]=useState<string|null>(null);
  const sheet=blueprint.find(x=>x.id===sheetId)!,rows=new Map(data.studio.rows.map(r=>[r.key,r]));
  const filtered=blueprint.filter(x=>(x.id+" "+x.fields.map(f=>f.label).join(" ")).includes(search));
  const history=data.studio.history.filter(r=>r.document.kind==="field"&&r.document.sheet===sheetId).sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
  return <section className={s.studio}><StoreNotice data={data}/><div className={s.heading}><div><p className={s.eyebrow}>설계 사전 · 41개 시트</p><h2>엑셀 뼈대가 에이와의 설계 사전으로</h2><p>최종본 2026.11.03 · 41개 시트 · 617개 항목. 항목 설명과 입력 기준을 지점별로 저장합니다.</p></div><button className={s.button} disabled title="시안 화면에서는 내려받기를 제공하지 않습니다">모델·변경값 내려받기 ↓</button></div>
    <div className={s.schemaLayout}><aside className={s.directory}><label>시트·항목 검색<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="수강, 90일, 기여도…"/></label><div className={s.list}>{filtered.map(item=><button key={item.id} aria-pressed={sheetId===item.id} onClick={()=>{setSheetId(item.id);setEditing(null);}}><strong>{item.id}</strong><small>{roleLabels[item.role]??"설계 시트"} · {item.fields.length}항목</small></button>)}</div></aside>
    <div className={s.paper}><div className={s.heading}><div><h3>{sheet.id}</h3><p>{roleLabels[sheet.role]??"설계 시트"} · 실제 값은 연결된 업무 화면에서 수정합니다.</p></div>{visibleHref(sheet.href)?<Link className={s.button} href={visibleHref(sheet.href)!}>해당 업무 열기 ↗</Link>:<span className={s.pill}>연결 화면 이식 전</span>}</div>
    <p className={s.note}>‘설계 기준’ 수정은 이 사전과 점검 화면에 반영됩니다. 기존 입력창의 필수 제한이나 계산식은 바뀌지 않습니다. 원본 식별자·열 순서는 유지됩니다.</p>
    <div className={s.tableWrap}><table><thead><tr><th>항목 / 원본 명칭</th><th>설계 기준</th><th>현재 자료 점검</th><th>정의·입력 안내</th><th>수정</th></tr></thead><tbody>{sheet.fields.map(field=>{
      const key=`field:${sheet.id}:${field.id}`,saved=rows.get(key),doc=saved?.document.kind==="field"?saved.document:undefined,audit=data.studio.audit.fields.find(a=>a.key===key);
      return <tr key={key}><td><strong>{doc?.label??field.label}</strong>{doc?.label&&doc.label!==field.label&&<small>원본: {field.label}</small>}</td><td><span className={doc?.required?s.orange:s.pill}>{doc?.required?"필수 점검":"선택·검토"}</span></td><td>{audit?<details><summary><span className={audit.missing?s.orange:s.green}>{audit.missing?`미입력 ${audit.missing} / ${audit.total}`:audit.total?`${audit.total}건 입력됨`:"대상 없음"}</span></summary><small>{audit.scope} · 현재 저장값 · 빈값 검사</small>{audit.examples.map((p,i)=><Link key={i} href={p.href}>{p.label} 수정 ↗</Link>)}{audit.missing>20&&<small>처음 20건 표시</small>}</details>:data.studio.audit.ran?<small>자동 빈값 검사 미연결<br/>업무 화면에서 확인</small>:<small>빈값 점검 미실행<br/>위 ‘점검 실행’을 눌러 주세요</small>}</td><td>{doc?.note||"입력 기준을 작성해 주세요"}</td><td><button disabled={!data.studio.canWrite} onClick={()=>setEditing(editing===field.id?null:field.id)}>정의 수정</button></td></tr>;
    })}</tbody></table></div>
    {editing!==null&&<FieldEditor key={`${sheet.id}:${editing}:${rows.get(`field:${sheet.id}:${editing}`)?.version??0}`} data={data} sheet={sheet.id} field={editing} label={sheet.fields.find(f=>f.id===editing)!.label} row={rows.get(`field:${sheet.id}:${editing}`)} onClose={()=>setEditing(null)}/>}
    <details className={s.history}><summary>이 시트의 변경 이력 · {history.length}건</summary>{history.length?history.slice(0,60).map(r=><p key={`${r.key}:${r.version}`}><strong>v{r.version} · {r.document.label}</strong> · {data.staff.find(p=>p.id===r.actor_id)?.display_name??"기록 담당자"} · {new Date(r.recorded_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}<br/>{r.document.kind==="field"&&`${r.document.required?"필수 점검":"선택·검토"} · ${r.document.note}`}</p>):<p>아직 변경한 정의가 없습니다.</p>}</details>
    </div></div></section>;
}
function FieldEditor({data,sheet,field,label,row,onClose}:{data:AcademyKnowledgeData;sheet:string;field:string;label:string;row?:StudioRow;onClose:()=>void}) {
  const original=row?.document.kind==="field"?row.document:{kind:"field" as const,sheet,field,label,required:false,note:""};
  const [doc,setDoc]=useState(original),{save,busy,message}=useSave(data);
  return <form className={s.editor} onSubmit={async e=>{e.preventDefault();if(await save(`field:${sheet}:${field}`,row?.version??0,doc))onClose();}}><h3>{label} · 정의 편집</h3><div className={s.formGrid}><label>표시 항목명<input required maxLength={160} value={doc.label} onChange={e=>setDoc({...doc,label:e.target.value})}/></label><label className={s.check}><input type="checkbox" checked={doc.required} onChange={e=>setDoc({...doc,required:e.target.checked})}/>보완 점검에서 우선 확인할 필수 항목</label></div><label>정의·작성 방법<textarea maxLength={1200} value={doc.note} onChange={e=>setDoc({...doc,note:e.target.value})} placeholder="누가, 언제, 어떤 기준으로 기록하는지 작성하세요"/></label><div className={s.actions}><button type="submit" disabled={busy||!data.studio.canWrite}>변경 저장</button><button type="button" onClick={onClose}>닫기</button><span role="status">{message}</span></div></form>;
}

/** 근거 있는 참고 관계 편집 — 지식그래프 탭(graph-tab.tsx)이 연다. */
export function LinkEditor({data,from,row,onClose}:{data:AcademyKnowledgeData;from:string;row?:StudioRow;onClose:()=>void}) {
  const [key]=useState(()=>row?.key??`link:${crypto.randomUUID()}`),[doc,setDoc]=useState<Extract<StudioDocument,{kind:"link"}>>(row?.document.kind==="link"?row.document:{kind:"link",from,to:"",label:"참고 관계",basis:"",date:data.today,state:"pending"});
  const [filter,setFilter]=useState(""),{save,busy,message}=useSave(data);
  const options=data.graph.nodes.filter(n=>`${n.label} ${n.id}`.includes(filter)).slice(0,100);
  const selectedNodes=data.graph.nodes.filter(n=>n.id===doc.from||n.id===doc.to),available=[...new Map([...selectedNodes,...options].map(n=>[n.id,n])).values()];
  return <form className={s.editor} onSubmit={async e=>{e.preventDefault();if(await save(key,row?.version??0,doc))onClose();}}><h3>근거 있는 참고 관계</h3><p>기존 수강·담당·수납 기록을 바꾸지 않는 참고 연결입니다. 실제 업무 관계의 수정은 원기록 화면에서 처리하세요.</p><label>연결할 기록 검색<input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="이름 또는 기록 제목"/></label><div className={s.formGrid}>{(["from","to"] as const).map(field=><label key={field}>{field==="from"?"주체 기록":"연결할 대상"}<select required value={doc[field]} onChange={e=>setDoc({...doc,[field]:e.target.value})}><option value="">기록 선택</option>{available.map(n=><option key={n.id} value={n.id}>{n.label} · {labels[n.type]} · {n.id.slice(-6)}</option>)}</select></label>)}<label>관계 이름<input maxLength={160} required value={doc.label} onChange={e=>setDoc({...doc,label:e.target.value})}/></label><label>확인일<input type="date" required max={data.today} value={doc.date} onChange={e=>setDoc({...doc,date:e.target.value})}/></label></div><label>확인 근거·출처<textarea required minLength={5} maxLength={1500} value={doc.basis} onChange={e=>setDoc({...doc,basis:e.target.value})} placeholder="확인한 원기록, 상담 일자, 문서 위치 등"/></label><label>반영 상태<select value={doc.state} onChange={e=>setDoc({...doc,state:e.target.value as typeof doc.state})}><option value="pending">확인 대기 · 점선 표시</option><option value="confirmed">근거 확인 완료 · 실선 반영</option><option value="retired">사용 중지 · 이력 보관</option></select></label><div className={s.actions}><button disabled={busy||!data.studio.canWrite}>관계 저장</button><button type="button" onClick={onClose}>닫기</button><span role="status">{message}</span></div></form>;
}

export function QualityTab({data}:{data:AcademyKnowledgeData}) {
  const visibleHref=useVisibleHref();
  const rules=expectations(data.studio.rows),[editing,setEditing]=useState<Expectation|null>(null);
  const fields=[...data.studio.audit.fields].filter(a=>a.missing>0).sort((a,b)=>Number(data.studio.rows.find(r=>r.key===b.key)?.document.kind==="field"&& (data.studio.rows.find(r=>r.key===b.key)!.document as Extract<StudioDocument,{kind:"field"}>).required)-Number(data.studio.rows.find(r=>r.key===a.key)?.document.kind==="field"&&(data.studio.rows.find(r=>r.key===a.key)!.document as Extract<StudioDocument,{kind:"field"}>).required)||b.missing-a.missing);
  const unmapped=blueprint.map(sheet=>({...sheet,unchecked:sheet.fields.filter(f=>!data.studio.audit.fields.some(a=>a.key===`field:${sheet.id}:${f.id}`)).length})).filter(sheet=>sheet.unchecked>0);
  const waiting=data.studio.rows.filter(r=>r.document.kind==="link"&&r.document.state==="pending");
  const unavailable=data.status.filter(x=>x.state!=="연결");
  // 원본 빈값 점검은 버튼을 눌러야 돈다 — 실행 전에는 0건·'빈값 없음'으로 말하지 않는다(미실행으로 밝힌다).
  const ran=data.studio.audit.ran;
  return <section className={s.studio}><StoreNotice data={data}/><div className={s.heading}><div><p className={s.eyebrow}>자료 품질 · 다음 할 일</p><h2>채워야 할 곳부터 한눈에</h2><p>실제 빈값, 확인 대기, 조회 실패, 수집 미완료를 구분합니다.</p></div></div><div className={s.qualityCards}><article><span>빈값이 있는 항목</span><strong>{ran?fields.length:"미실행"}</strong><small>{ran?"현재 기본정보 12개 항목 검사":"위 ‘점검 실행’을 누르면 채워집니다"}</small></article><article><span>직접 연결 확인 대기</span><strong>{waiting.length}</strong><small>확인 전에는 실제 관계로 합산하지 않음</small></article><article><span>제외된 관계</span><strong>{data.graph.issues.reduce((n,i)=>n+i.count,0)}</strong><small>대상·개체 유형 검증 필요</small></article><article><span>수집·조회 확인</span><strong>{unavailable.length+data.studio.audit.errors.length}</strong><small>실제 자료 없음과 구분</small></article></div>
    <div className={s.twoColumns}><section className={s.paper}><h3>미입력 기본정보</h3>{!ran&&<p>원본 빈값 점검을 아직 실행하지 않았습니다. 위 ‘점검 실행’을 누르면 미입력 항목이 여기에 표시됩니다.</p>}{ran&&<p>기준일 {data.studio.audit.asOf} · 과거 월 조회와 별개인 현재 저장값입니다. 필수 점검 항목을 먼저 표시합니다.</p>}{fields.map(a=>{const [,sheet,id]=a.key.split(":"),label=data.studio.rows.find(r=>r.key===a.key)?.document.label??blueprint.find(b=>b.id===sheet)?.fields.find(f=>f.id===id)?.label;return <details key={a.key} className={s.record}><summary>{sheet} · {label} <strong className={s.orange}>{a.missing} / {a.total}건</strong></summary><p>{a.scope}</p>{a.examples.map((x,i)=><Link key={i} className={s.inlineLink} href={x.href}>{x.label} 수정 ↗</Link>)}{a.missing>20&&<small>처음 20건 표시</small>}</details>;})}{ran&&!fields.length&&<p>조회에 성공한 점검 항목에는 빈값이 없습니다. 나머지 항목은 자동 검사 미연결입니다.</p>}</section>
    <section className={s.paper}><h3>연결·수집 보완</h3>{unavailable.map(x=><article key={x.name} className={s.record}><strong>{x.name} · {x.state}</strong><p>{x.detail}</p></article>)}{data.graph.issues.map((i,n)=><details className={s.warning} key={n}><summary>{i.reason} · {i.count}건</summary>{i.examples?.map((e,j)=><p className={s.break} key={j}>{data.graph.nodes.find(x=>x.id===e.from)?.label??e.from} → {data.graph.nodes.find(x=>x.id===e.to)?.label??e.to}<br/>관계: {e.relation}</p>)}<small>확인할 관계 최대 10건 표시 · 원본 ID 매핑을 점검해 주세요.</small></details>)}{data.studio.audit.errors.map(x=><p role="alert" key={x}>{x}</p>)}<Link className={s.button} href="/dashboard/management#sources">자료 수집·대사 화면 열기 ↗</Link><p className={s.note}>외부 수집이 끝나지 않은 자료는 그래프 선을 추가해도 수집 완료가 되지 않습니다.</p></section></div>
    {ran&&<details className={s.history}><summary>빈값 자동 검사 미연결 · {unmapped.reduce((n,x)=>n+x.unchecked,0)}개 항목</summary><p>계산·조회 항목도 포함됩니다. 미입력 건수가 아니라 검사 기능 연결 여부입니다.</p>{unmapped.map(x=><p key={x.id}>{visibleHref(x.href)?<Link href={visibleHref(x.href)!}>{x.id} · {x.unchecked}개 항목 · 업무에서 확인 ↗</Link>:`${x.id} · ${x.unchecked}개 항목`}</p>)}</details>}
    <section className={s.paper}><div className={s.heading}><div><h3>주체별 연결 점검 기준</h3><p>어떤 주체에 어떤 유형의 기록이 몇 개 이상 연결되어야 하는지 정합니다. 저장하면 그래프의 보완 점선에 즉시 반영됩니다.</p></div><button disabled={!data.studio.canWrite} onClick={()=>setEditing({key:`expectation:${crypto.randomUUID()}`,version:0,kind:"expectation",label:"새 연결 점검",subject:"Student",target:"Observation",minimum:1,active:true})}>점검 기준 추가</button></div><div className={s.tableWrap}><table><thead><tr><th>주체</th><th>점검 항목</th><th>필요한 연결</th><th>기준</th><th>편집</th></tr></thead><tbody>{rules.map(r=><tr key={r.key}><td>{labels[r.subject]}</td><td>{r.label}</td><td>{labels[r.target]} · {r.minimum}개 이상</td><td>{r.active?"점검 중":"사용 중지"}</td><td><button disabled={!data.studio.canWrite} onClick={()=>setEditing(r)}>수정</button></td></tr>)}</tbody></table></div>{editing&&<ExpectationEditor key={`${editing.key}:${rules.find(r=>r.key===editing.key)?.version??0}`} data={data} rule={rules.find(r=>r.key===editing.key)??editing} onClose={()=>setEditing(null)}/>}</section>
  </section>;
}
function ExpectationEditor({data,rule,onClose}:{data:AcademyKnowledgeData;rule:Expectation;onClose:()=>void}) {
  const [doc,setDoc]=useState<Extract<StudioDocument,{kind:"expectation"}>>({kind:"expectation",label:rule.label,subject:rule.subject,target:rule.target,minimum:rule.minimum,active:rule.active}),{save,busy,message}=useSave(data);
  return <form className={s.editor} onSubmit={async e=>{e.preventDefault();if(await save(rule.key,rule.version,doc))onClose();}}><div className={s.formGrid}><label>점검 이름<input required maxLength={160} value={doc.label} onChange={e=>setDoc({...doc,label:e.target.value})}/></label>{(["subject","target"] as const).map(key=><label key={key}>{key==="subject"?"주체 유형":"필요한 기록 유형"}<select value={doc[key]} onChange={e=>setDoc({...doc,[key]:e.target.value as typeof doc.subject})}>{entities.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>)}<label>최소 연결 개수<input required type="number" min={1} max={100} step={1} value={doc.minimum} onChange={e=>setDoc({...doc,minimum:Number(e.target.value)})}/></label><label className={s.check}><input type="checkbox" checked={doc.active} onChange={e=>setDoc({...doc,active:e.target.checked})}/>이 기준으로 점검</label></div><div className={s.actions}><button disabled={busy||!data.studio.canWrite}>기준 저장</button><button type="button" onClick={onClose}>닫기</button><span role="status">{message}</span></div></form>;
}
