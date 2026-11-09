"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { useState } from "react";
import { withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { blankCampaign, channels, objectives, seasons, states, type CampaignDocument } from "./model";
import { blankOperation, operationTemplates, type OperationsData, type OperationDocument, type TemplateKey } from "./operations-model";
import { annualDecisions, draftFromReference, referenceYears, type AnnualReference, type AnnualMetric, type AnnualPlanning } from "./annual-planning-model";
import { useSaveOperation } from "./operations-workspace";
import s from "./annual-planning.module.css";

type Props={data:Pick<OperationsData,"annualReferences"|"actorId"|"canPlan"|"canAnalyze"|"canEditCost"|"staff"|"today">;year:number;metrics:AnnualMetric[];metricsAvailable:boolean};
type Draft={id:string;doc:CampaignDocument;op:OperationDocument;planning:AnnualPlanning};
const money=(v:number|null|undefined)=>v==null?"자료 미확인":`${v.toLocaleString("ko-KR")}원`;
export function AnnualPlanningWorkspace({data,year,metrics,metricsAvailable}:Props){
  const inFrame=useInFrame();
  const [month,setMonth]=useState(1),[draft,setDraft]=useState<Draft|null>(null),[notice,setNotice]=useState(""),[saved,setSaved]=useState<string|null>(null);
  const {save,busy,message}=useSaveOperation(),years=referenceYears(year),references=data.annualReferences;
  const historical=references.filter(r=>years.includes(Number(r.document.start.slice(0,4))));
  const planned=references.filter(r=>Number(r.document.start.slice(0,4))===year);
  const monthRows=(rows:AnnualReference[])=>rows.filter(r=>Number(r.document.start.slice(5,7))===month).sort((a,b)=>a.document.start.localeCompare(b.document.start));
  function startDraft(source?:AnnualReference){
    setNotice("");setSaved(null);
    if(draft){
      if(!source||draft.planning.referenceIds.includes(source.id))return;
      if(draft.planning.referenceIds.length>=12){setNotice("한 계획에 최대 12개 참고 행사를 연결할 수 있습니다.");return;}
      setDraft({...draft,planning:{...draft.planning,referenceIds:[...draft.planning.referenceIds,source.id]}});return;
    }
    const doc=source?draftFromReference(source,year):{...blankCampaign(`${year}-${String(month).padStart(2,"0")}-01`),channel:"event" as const};
    const template=doc.channel==="seminar"?"seminar":doc.channel==="flyer"?"flyer":"custom";
    setDraft({id:crypto.randomUUID(),doc,op:blankOperation(data.actorId,template),planning:{targetYear:year,referenceIds:source?[source.id]:[],decision:source?"improve":"new",reason:"",considerations:""}});
  }
  const updateDoc=<K extends keyof CampaignDocument>(key:K,value:CampaignDocument[K])=>setDraft(d=>d?{...d,doc:{...d.doc,[key]:value}}:d);
  const updateOp=<K extends keyof OperationDocument>(key:K,value:OperationDocument[K])=>setDraft(d=>d?{...d,op:{...d.op,[key]:value}}:d);
  const updatePlanning=<K extends keyof AnnualPlanning>(key:K,value:AnnualPlanning[K])=>setDraft(d=>d?{...d,planning:{...d.planning,[key]:value}}:d);
  async function submit(e:React.FormEvent){
    e.preventDefault();if(!draft)return;
    const {title,start,end,channel,objective,season,audience,budget}=draft.doc;
    await save({action:"plan",id:draft.id,expectedVersion:0,expectedOperationVersion:0,plan:{title,start,end,channel,objective,season,audience,budget,actualCost:null,costBasis:"",state:"planned"},operation:{...draft.op,annualPlanning:draft.planning}},id=>{setSaved(id);setDraft(null);setNotice("신년 계획과 준비 업무를 저장했습니다. 참고 행사도 같은 계획에 연결되었습니다.");setMonth(Number(start.slice(5,7)));});
  }
  return <main className={s.page}>
    <header className={s.hero}><div><span>AYWA · ANNUAL PLANNING STUDIO</span><h1>3년의 기록으로, 다음 1년을 설계</h1><p>{years.join(" · ")}년의 일정과 회고를 비교하고 {year}년 계획을 바로 작성하세요.</p></div><Link href="/marketing">연간 운영계획으로 ↗</Link></header>
    <div className={s.toolbar}><label>신년 기획 연도<select aria-label="신년 기획 연도" disabled={!!draft||busy} value={year} onChange={e=>{const href=`/marketing/annual?year=${e.target.value}`;window.location.href=inFrame?withEmbed(href):href;}}>{Array.from({length:Math.max(7,year-2023)},(_,n)=>2024+n).map(y=><option key={y} value={y}>{y}년</option>)}</select></label><p>① 과거 3개년 비교　→　② 참고 행사 선택　→　③ 개선 이유·목표 기록　→　④ 준비 업무로 연결</p></div>
    <div className={s.summary}><article><span>직전 3개년 참고 기록</span><strong>{historical.length}<small>건</small></strong></article><article><span>{year}년 일정 · 취소 제외</span><strong>{planned.filter(r=>r.document.state!=="cancelled").length}<small>건</small></strong></article><article><span>과거 기록을 연결한 계획</span><strong>{planned.filter(r=>r.document.state!=="cancelled"&&r.planning?.referenceIds.length).length}<small>건</small></strong></article></div>
    <nav className={s.months} aria-label="비교할 월">{Array.from({length:12},(_,i)=>i+1).map(m=><button key={m} aria-pressed={month===m} onClick={()=>setMonth(m)}><strong>{m}월</strong><small>{historical.filter(r=>Number(r.document.start.slice(5,7))===m).length}건 참고 · {planned.filter(r=>r.document.state!=="cancelled"&&Number(r.document.start.slice(5,7))===m).length}건 계획</small></button>)}</nav>
    <p className={s.hint}>행사는 시작 월에 표시합니다. 기간 전체는 상세에서 확인하세요. 일정 기록만으로 실제 진행·매출 기여가 확인되지는 않습니다. {data.canAnalyze?"성과는 접점 균등 배분·90일 기준이며, 미확인 값은 0으로 표시하지 않습니다.":"비용·매출 지표는 경영 분석 권한이 있는 계정에서 확인합니다."}</p>
    {data.canAnalyze&&!metricsAvailable&&<p role="status" className={s.warning}>성과 자료를 읽지 못했습니다. 일정 기획은 가능하며, 경영 분석 화면에서 다시 확인해 주세요.</p>}
    <div role="status" aria-live="polite" className={s.notice}>{notice}{saved&&<> <Link href={`/marketing?event=${saved}&year=${year}`}>저장한 계획·담당 업무 열기 ↗</Link></>}</div>
    <div className={s.boardScroll}><div className={s.board}>
      {years.map((y,i)=><section className={s.history} key={y}><header><span>{3-i}년 전</span><h2>{y}<small>년 {month}월</small></h2><b>{monthRows(historical.filter(r=>r.document.start.startsWith(String(y)))).length}건</b></header><div className={s.cards}>{monthRows(historical.filter(r=>r.document.start.startsWith(String(y)))).map(r=><ReferenceCard key={r.id} reference={r} metric={metrics.find(m=>m.id===r.id)} canAnalyze={data.canAnalyze} selected={!!draft?.planning.referenceIds.includes(r.id)} onSelect={data.canPlan?()=>startDraft(r):undefined}/>)}{!monthRows(historical.filter(r=>r.document.start.startsWith(String(y)))).length&&<div className={s.empty}>등록된 일정이 없습니다.<br/><small>행사가 없었다는 의미는 아닙니다.</small></div>}</div></section>)}
      <section className={s.future}><header><span>새로운 계획</span><h2>{year}<small>년 {month}월</small></h2><b>{monthRows(planned).length}건</b></header><div className={s.cards}>
        {monthRows(planned).map(r=><article className={s.planned} key={r.id}><span>{r.document.start.slice(5)} · {states[r.document.state]}</span><Link href={`/marketing?event=${r.id}&year=${year}`}><strong>{r.document.title}</strong></Link>{r.planning&&<><p>{annualDecisions[r.planning.decision]} · 참고 {r.planning.referenceIds.length}건</p><p>{r.planning.reason}</p></>}</article>)}
        {!draft&&data.canPlan&&<button className={s.add} onClick={()=>startDraft()}>＋ {month}월 새 계획 작성</button>}
        {!data.canPlan&&<p className={s.empty}>기획 담당자가 저장한 신년 일정을 확인할 수 있습니다.</p>}
        {draft&&<form className={s.form} onSubmit={submit}><h3>신년 행사 기획</h3><p className={s.hint}>다른 월을 살펴봐도 작성 중인 내용은 유지됩니다. 날짜는 실제 학사일정을 확인해 조정하세요.</p>
          <div className={s.references}><b>참고하는 과거 행사 {draft.planning.referenceIds.length}/12</b>{draft.planning.referenceIds.map(id=>{const r=references.find(r=>r.id===id);return <div key={id}><Link href={`/marketing?event=${id}`} target="_blank" rel="noopener noreferrer">{r?.document.start} · {r?.document.title??"참고 행사"}</Link><button type="button" aria-label={`${r?.document.title??"참고 행사"} 참고 해제`} disabled={busy} onClick={()=>updatePlanning("referenceIds",draft.planning.referenceIds.filter(r=>r!==id))}>×</button></div>;})}</div>
          <fieldset disabled={busy}><label>행사명<input required maxLength={240} value={draft.doc.title} onChange={e=>updateDoc("title",e.target.value)}/></label>
            <div className={s.pair}><label>시작일<input type="date" required min={`${year}-01-01`} max={`${year}-12-31`} value={draft.doc.start} onChange={e=>setDraft({...draft,doc:{...draft.doc,start:e.target.value,end:draft.doc.end<e.target.value?e.target.value:draft.doc.end}})}/></label><label>종료일<input type="date" required min={draft.doc.start} value={draft.doc.end} onChange={e=>updateDoc("end",e.target.value)}/></label></div>
            <label>기획 방향<select value={draft.planning.decision} onChange={e=>updatePlanning("decision",e.target.value as AnnualPlanning["decision"])}>{Object.entries(annualDecisions).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label>기획·변경 이유<textarea required minLength={2} maxLength={1500} value={draft.planning.reason} onChange={e=>updatePlanning("reason",e.target.value)} placeholder="예: 작년 기말고사와 겹쳐 참여가 적어, 올해는 시험 직후로 조정"/></label>
            <label>준비 시 확인할 점<textarea maxLength={2000} value={draft.planning.considerations} onChange={e=>updatePlanning("considerations",e.target.value)} placeholder="학교별 시험일, 장소·연사, 우천 대안, 예산 근거 등"/></label>
            <label>행사 책임자<select required value={draft.op.ownerId} onChange={e=>updateOp("ownerId",e.target.value)}>{data.staff.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <div className={s.pair}><label>홍보 채널<select value={draft.doc.channel} onChange={e=>updateDoc("channel",e.target.value as CampaignDocument["channel"])}>{Object.entries(channels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>준비 업무 템플릿<select value={draft.op.template} onChange={e=>updateOp("template",e.target.value as TemplateKey)}>{Object.entries(operationTemplates).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></label></div>
            <div className={s.pair}><label>목적<select value={draft.doc.objective} onChange={e=>updateDoc("objective",e.target.value as CampaignDocument["objective"])}>{Object.entries(objectives).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>시즌<select value={draft.doc.season} onChange={e=>updateDoc("season",e.target.value as CampaignDocument["season"])}>{Object.entries(seasons).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
            <label>대상 학교·학년<input maxLength={240} value={draft.doc.audience} onChange={e=>updateDoc("audience",e.target.value)}/></label><label>장소·배부 구역<input maxLength={240} value={draft.op.location} onChange={e=>updateOp("location",e.target.value)}/></label>
            <div className={s.pair}><label>참석 목표(명)<input type="number" min={0} max={100000} value={draft.op.targetAttendees??""} onChange={e=>updateOp("targetAttendees",e.target.value===""?null:Number(e.target.value))}/></label><label>등록 목표(명)<input type="number" min={0} max={100000} value={draft.op.targetEnrollments??""} onChange={e=>updateOp("targetEnrollments",e.target.value===""?null:Number(e.target.value))}/></label></div>
            {data.canEditCost&&<label>올해 계획 예산(원)<input type="number" min={0} max={1e12} value={draft.doc.budget??""} onChange={e=>updateDoc("budget",e.target.value===""?null:Number(e.target.value))}/></label>}
            <label>기획 내용·성공 기준<textarea maxLength={4000} value={draft.op.brief} onChange={e=>updateOp("brief",e.target.value)} placeholder="핵심 메시지, 실행 방법, 성과 확인일과 기준"/></label>
            <p className={s.hint}>저장하면 준비 업무 {operationTemplates[draft.op.template].tasks.length}개가 행사 책임자에게 배정됩니다. 과거 비용·참석자·실적은 신년 실적으로 복사되지 않습니다.</p>
            <button className={s.primary} type="submit">{busy?"저장 중…":"신년 계획·준비 업무 저장"}</button><button type="button" onClick={()=>{setDraft(null);setNotice("작성 중인 계획을 닫았습니다.");}}>작성 취소</button>
          </fieldset>{message&&<p role="status">{message}</p>}
        </form>}
      </div></section>
    </div></div>
    <footer className={s.hint}>신년 계획은 연간 운영계획과 같은 행사 기록입니다. 이후 담당 업무·초대·참석·상담·결과를 같은 행사에 기록하면 다음 연도 비교에도 이어집니다. 참고 연결은 기획의 근거이며 매출 증가의 인과관계를 뜻하지 않습니다.</footer>
  </main>;
}

function ReferenceCard({reference:r,metric,canAnalyze,selected,onSelect}:{reference:AnnualReference;metric?:AnnualMetric;canAnalyze:boolean;selected:boolean;onSelect?:()=>void}){
  return <article className={`${s.card} ${selected?s.selected:""}`}><span>{r.document.start.slice(5)}{r.document.end!==r.document.start?` ~ ${r.document.end}`:""} · {channels[r.document.channel]}</span><h3>{r.document.title}</h3><small className={s.badge}>{states[r.document.state]}</small><p>{r.document.audience||"대상 미기록"}</p>
    {canAnalyze&&<dl className={s.metrics}><div><dt>실제 집행비</dt><dd>{money(r.document.actualCost)}</dd></div><div><dt>기여 등록</dt><dd>{metric?.enrollments==null?"자료 미확인":`${Number(metric.enrollments.toFixed(2))}명`}</dd></div><div><dt>등록당 비용</dt><dd>{money(metric?.cpe==null?null:Math.round(metric.cpe))}</dd></div><div><dt>3개월 실청구 기여액</dt><dd>{money(metric?.revenue==null?null:Math.round(metric.revenue))}</dd></div><div><dt>ROI</dt><dd>{metric?.roi==null?"자료 미확인":`${metric.roi.toFixed(1)}%`}</dd></div></dl>}
    <div className={s.review}><b>결과·회고</b><p>{r.retrospective||"아직 기록되지 않았습니다."}</p>{r.nextAction&&<><b>다음 회차 개선</b><p>{r.nextAction}</p></>}</div>
    {canAnalyze&&!!metric?.gaps.length&&<details><summary>성과 확인에 필요한 자료</summary><p>{metric.gaps.join(" · ")}</p></details>}
    <div className={s.cardActions}><Link href={`/marketing?event=${r.id}`} target="_blank" rel="noopener noreferrer">원본 행사 ↗</Link>{onSelect&&<button disabled={selected} onClick={onSelect}>{selected?"참고에 추가됨":"기획에 참고 ＋"}</button>}</div>
  </article>;
}
