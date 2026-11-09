"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ContributionLink as Link } from "./student-contribution-scope";
import { AXES, FACTORS, FACTOR_MODEL, analyzeFactors, factorGraph, factorScore, type Factor, type Observation } from "../model/factors";
import type { FactorWorkspace as Data } from "../server/factor-query";
import { saveContributionFactor } from "../server/factor-actions";
import styles from "./factor-workspace.module.css";

const number=(n:number)=>n.toLocaleString("ko-KR",{maximumFractionDigits:1});
const stateName={measured:"확인됨",partial:"확인 필요",missing:"미측정",na:"해당 없음"};
export function FactorWorkspace({data}:{data:Data}) {
  const router=useRouter();const [axis,setAxis]=useState<string>("all");const [filter,setFilter]=useState("all");const [search,setSearch]=useState("");const [editing,setEditing]=useState<string|null>(null);
  const [month,setMonth]=useState(data.month);const [pending,start]=useTransition();const [message,setMessage]=useState("");
  const result=analyzeFactors(data.observations);
  const measured=data.observations.filter(o=>o.state==="measured").length;
  const factors=FACTORS.filter(f=>(axis==="all"||f.axis===axis)&&(!search||`${f.id} ${f.name} ${f.definition}`.includes(search))&&
    (filter==="all"||filter==="scored"&&!!f.cap||filter==="reference"&&!f.cap||filter==="missing"&&["missing","partial"].includes(data.observations.find(o=>o.factorId===f.id)!.state)));
  const exportGraph=()=>{
    const blob=new Blob([JSON.stringify(factorGraph(data.student.id,data.month,data.observations),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`student-factors-${data.student.id}-${data.month}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <main className={styles.root} aria-busy={pending}>
    <header className={styles.hero}>
      <div><Link href={`/student-contribution/${data.student.id}`} className={styles.back}>← 로열티 점수·상위 %</Link>
        <p className={styles.eyebrow}>STUDENT INSIGHT · 42 FACTORS</p><h1>{data.student.name}의 로열티 정밀분석</h1>
        <p>수익부터 관계·지원까지, 기록의 근거를 따라 학생을 이해합니다.</p></div>
      <form onSubmit={e=>{e.preventDefault();start(()=>router.push(`?month=${month}${typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("embed")?"&embed=1":""}`));}}>
        <label htmlFor="factor-month">분석 월</label><div><input id="factor-month" type="month" required min="2000-01" max={data.today.slice(0,7)} value={month} onChange={e=>setMonth(e.target.value)} /><button disabled={pending}>조회</button></div>
        <small>기준일 {data.asOf} · {data.month===data.today.slice(0,7)?"진행 중인 월":"현재 확인된 기록으로 재구성"}</small>
      </form>
    </header>
    {data.warnings.map(w=><p key={w} role="alert" className={styles.warning}>{w}</p>)}
    {message&&<p role="status" className={styles.notice}>{message}</p>}
    <section className={styles.summary} aria-label="정밀분석 요약">
      <article className={styles.total}><span>7축 종합 지수 · 최대 100</span><strong>{!data.storageReady?"조회 보류":result.score===null?"산출 대기":number(result.score)}</strong>
        <p>{data.storageReady&&result.score===null?`미측정값에 따른 가능 범위 ${number(result.lower)}~${number(result.upper)}`:"동일한 기준으로 측정한 24개 팩터의 가중 지수"}</p>
        <small>기존 누적 점수·별 9등급과 별도 지표입니다.</small></article>
      <article><span>점수 근거 충족</span><strong>{result.known}<em> / {result.total}</em></strong><progress value={result.known} max={result.total||1} aria-label="점수 근거 충족" /><p>미측정·확인 필요는 0점으로 확정하지 않습니다.</p></article>
      <article><span>확인된 팩터</span><strong>{measured}<em> / 42</em></strong><p>점수 24개 + 맥락·지원 참고 18개</p><button className={styles.textButton} onClick={()=>{setAxis("all");setFilter("missing");}}>확인이 필요한 항목 보기 →</button></article>
    </section>
    <section aria-label="7개 축별 분석" className={styles.axes}>
      {result.axes.map(a=><button key={a.id} aria-pressed={axis===a.id} onClick={()=>{setAxis(a.id);setFilter("all");}} style={{borderTopColor:a.color}}>
        <div><b>{a.name}</b><small>{a.cost?"차감":"가산"} {a.weight}%</small></div>
        <strong>{!data.storageReady?"—":a.score===null?`${number(a.lower)}~${number(a.upper)}`:number(a.score)}<small> / 100</small></strong>
        <div className={styles.bar} aria-hidden="true"><i style={{width:`${a.upper}%`,background:`${a.color}35`}} /><i style={{width:`${a.lower}%`,background:a.color}} /></div>
        <p>{a.known}/{a.total}개 확인{a.excluded?` · 해당 없음 ${a.excluded}`:""} · {a.cost?"낮을수록 부담 감소":"높을수록 기여 증가"}</p>
      </button>)}
    </section>
    <details className={styles.method}><summary>계산 방법·엑셀 반영 기준</summary>
      <p>24_기여도팩터의 42개 항목을 모두 유지합니다. 원본의 Y 표시는 실제 25개이며, 거주 유형(F18)은 점수에서 제외해 24개를 계산합니다. 주거·학교 정보는 소통과 수업 기획에 활용합니다.</p>
      <p>항목별 원값을 0~100점으로 변환하고 축 안에서 동일 가중치로 평균합니다. 가족 동시 재원에 가장 큰 40%를 배정합니다(본인 포함 2명 20점·3명 35점·4명 이상 40점). 나머지 수익·유지·확산·성장 축은 20·20·10·10%로 합산하고, 지원 부담 15%와 유지 위험 10%를 차감합니다. 최종 범위는 0~100입니다. 가족 재원을 우선하는 운영 기준으로, 예측 정확도가 검증된 모형은 아닙니다.</p>
      <p>미측정·미확인 항목은 0~100의 미지수로 남겨 최저~최고 가능 범위를 표시합니다. 담당자가 근거와 함께 ‘해당 없음’을 확인하면 해당 축의 분모에서 제외합니다. 축 전체가 해당 없거나 근거를 불러오지 못하면 종합 산출을 보류합니다.</p>
      <p>월별 입력은 다음 달로 자동 이월하지 않습니다. 과거 월의 자동값은 현재 저장된 자료로 다시 계산되며 마감 당시 확정 스냅샷이 아닙니다. 모델 {FACTOR_MODEL} · 재원 기간, 통학 시간 등의 기준은 각 항목에서 확인할 수 있습니다.</p>
    </details>
    <section className={styles.workspace} aria-label="팩터별 입력과 근거">
      <div className={styles.heading}><div><h2>팩터별 기록과 근거</h2><p>에이와 기록을 자동 연결하고, 부족한 값은 이 학생 화면에서 보완하세요.</p></div><button onClick={exportGraph} disabled={!data.storageReady}>근거 지식그래프 JSON 내려받기</button></div>
      <nav className={styles.tabs} aria-label="분석 축 선택"><button aria-pressed={axis==="all"} onClick={()=>setAxis("all")}>전체 42</button>{AXES.map(a=><button key={a.id} aria-pressed={axis===a.id} onClick={()=>setAxis(a.id)}>{a.name}</button>)}</nav>
      <div className={styles.filters}><label>항목 검색<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="항목명·설명·F01" /></label><label>표시 범위<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체 항목</option><option value="missing">미측정·확인 필요</option><option value="scored">점수 반영</option><option value="reference">참고 정보</option></select></label><span>{factors.length}개 항목</span></div>
      {!factors.length&&<p className={styles.empty}>조건에 맞는 팩터가 없습니다.</p>}
      {factors.map(f=>{const o=data.observations.find(o=>o.factorId===f.id)!;const score=o.state==="measured"&&o.value!==null?factorScore(f,o.value):null;
        return <article key={f.id} className={styles.factor}>
          <div className={styles.factorHead}><div><small>{f.id} · {AXES.find(a=>a.id===f.axis)!.name} · {f.cap?"점수 반영":"참고 정보"}</small><h3>{f.name}</h3><p>{f.window}</p></div>
            <div className={styles.value}><span data-state={o.state}>{stateName[o.state]}{o.source==="auto"?" · 자동":o.source==="manual"?" · 담당자 기록":""}</span>
              <strong>{o.value===null?"—":typeof o.value==="number"?`${number(o.value)} ${f.unit}`:o.value}</strong>
              {score!==null&&<small>환산 {number(score)} / 100점</small>}</div>
            {data.canWrite&&<button onClick={()=>setEditing(editing===f.id?null:f.id)} aria-expanded={editing===f.id} aria-controls={`editor-${f.id}`}>{editing===f.id?"닫기":o.state==="missing"?"기록 입력":"확인·수정"}</button>}
          </div>
          <details><summary>정의·산출 근거{o.refs.length?` · 원기록 ${o.refs.length}건`:""}</summary><p>{f.definition}</p>
            {f.id==="F13"?<p>종합 지수의 최대 40점: 형제자매 1명 20점 · 2명 35점 · 3명 이상 40점(본인 제외). 목록의 현재 가족 가점과 별도인 정밀 지수입니다.</p>:f.cap&&<p>환산: {f.inverse?`100 × (1 − 값/${number(f.cap)})`:`100 × 값/${number(f.cap)}`} · 0~100점 범위로 제한</p>}
            <p className={styles.evidence}>{o.evidence}</p>{o.actor&&<p>{o.actor} · {o.recordedAt&&new Date(o.recordedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}</p>}
            {o.href&&<Link href={o.href}>연결된 학생 원기록 열기 →</Link>}
            <p className={styles.graph}>학생 → {data.month} 관측값 → {f.name} → {AXES.find(a=>a.id===f.axis)!.name}{o.refs.length?" · 원기록 ID 연결됨":" · 근거 보완 필요"}</p>
          </details>
          {editing===f.id&&<FactorEditor key={`${f.id}-${o.version}`} factor={f} observation={o} data={data} onSaved={text=>{setMessage(text);setEditing(null);router.refresh();}} />}
        </article>;
      })}
    </section>
  </main>;
}

function FactorEditor({factor:f,observation:o,data,onSaved}:{factor:Factor;observation:Observation;data:Data;onSaved:(message:string)=>void}) {
  const [state,setState]=useState("measured");const [value,setValue]=useState(o.value===null?"":String(o.value));const [evidence,setEvidence]=useState(o.source==="manual"?o.evidence:"");
  const [pending,start]=useTransition();const [error,setError]=useState("");
  const history=data.history.filter(r=>r.factor_id===f.id);
  function submit(e:FormEvent){e.preventDefault();setError("");start(async()=>{try{
    const result=await saveContributionFactor({studentId:data.student.id,month:data.month,factorId:f.id,state,value:state!=="measured"?null:f.unit==="메모"?value.trim():value.trim()===""?null:Number(value),evidence,version:o.version});
    if(result.ok)onSaved(result.message);else setError(result.message);
  }catch{setError("저장하지 못했습니다. 로그인 상태를 확인해 주세요. 입력 내용은 유지됩니다.");}});}
  return <section id={`editor-${f.id}`} className={styles.editor} aria-label={`${f.name} 기록`}>
    <form onSubmit={submit}><fieldset disabled={pending}><legend>{data.month} · {f.name} 확인 기록</legend>
      <p>기록자와 시간은 자동 저장됩니다. 이 월의 자동 계산값보다 확인 기록을 우선 적용합니다.</p>
      <label>처리 상태<select value={state} onChange={e=>setState(e.target.value)}><option value="measured">값·근거 확인 완료</option><option value="na">해당 없음 (사유 필수)</option><option value="reset">직접 입력 해제·자동 자료 사용</option></select></label>
      {state==="measured"&&<label>확인 값 ({f.unit}){f.options?<select required value={value} onChange={e=>setValue(e.target.value)}><option value="">선택</option>{f.options.map(x=><option key={x}>{x}</option>)}</select>:f.unit==="메모"?<textarea required maxLength={2000} value={value} onChange={e=>setValue(e.target.value)} />:<input required type="number" min={f.min??0} max={f.max??100000000} step={f.integer?1:"any"} value={value} onChange={e=>setValue(e.target.value)} />}</label>}
      <label>확인 근거·기간·후속 조치<textarea required minLength={3} maxLength={2000} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="확인한 날짜, 원기록/링크, 분자·분모 또는 계산 내역, 담당자 후속 조치를 기록하세요." /></label>
      <p>예: 출석률은 ‘출석 18 / 예정 수업 20, 6개월 시간표와 대사 완료’처럼 기록합니다. 값이 없는 것과 확인된 0을 구분해 주세요.</p>
      {error&&<p role="alert" className={styles.warning}>{error}</p>}<button className={styles.save} type="submit">{pending?"저장 중…":"근거와 함께 저장"}</button>
    </fieldset></form>
    {history.length>0&&<details><summary>이 항목 변경 이력 {history.length}건</summary>{history.slice(0,20).map(r=><p key={r.id}><b>v{r.version} · {r.actor}</b> · {new Date(r.recorded_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}<br />{r.state==="reset"?"자동 자료로 복원":r.state==="na"?"해당 없음":String(r.value)} · {r.evidence}</p>)}{history.length>20&&<p>최근 20건 표시 · 전체 이력은 보존됩니다.</p>}</details>}
  </section>;
}
