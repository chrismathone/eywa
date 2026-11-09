"use client";
import { EmbedLink as Link } from "@/components/embed-link";
import { SAMPLE_SAVE_MESSAGE } from "@/features/mockup/sample";
import { useState } from "react";
import { channels } from "./model";
import { inputKindLabels,inputStatusLabels,type CampaignChoice,type MarketingInputRecord } from "./input-model";
import s from "./inputs.module.css";
type ReviewRecord=MarketingInputRecord & {subjectLabel:string;actorLabel:string};
export function MarketingInputReview({records,campaigns,pending}:{records:ReviewRecord[];campaigns:CampaignChoice[];pending:number}){
  return <section className={s.panel}><div className={s.heading}><div><h2>담당자 입력 검토함</h2><p>확인 대기 {pending}건 · 오래된 순서로 최대 200건 · 처리 이력 최근 50건</p></div></div><p className={s.notice}>제출된 응답은 근거로 보관됩니다. 행사·대상·날짜를 확인해 ‘접점 확정’을 눌러야 학생 기록과 성과 계산에 사용됩니다. 확정하면 해당 행사의 측정 마감이 다시 열립니다.</p><div className={s.review}>{records.map(r=><ReviewRow key={`${r.id}:${r.version}`} record={r} campaigns={campaigns}/>)}{!records.length&&<p>아직 담당자가 제출한 기록이 없습니다. 신규 콜&상담 상세 또는 학생 통합보기에서 입력할 수 있습니다.</p>}</div></section>;
}
function ReviewRow({record:r,campaigns}:{record:ReviewRecord;campaigns:CampaignChoice[]}){
  const [campaign,setCampaign]=useState(r.campaign_id??""),[note,setNote]=useState(""),[busy]=useState(false),[message,setMessage]=useState("");
  async function review(action:"approve"|"reject"){
    if(busy)return;void action;setMessage(SAMPLE_SAVE_MESSAGE);
  }
  return <article><strong>{r.subjectLabel} · {inputKindLabels[r.document.kind]} · {inputStatusLabels[r.status]}</strong><p>{r.document.date} · {channels[r.document.channel]} · 입력자 {r.actorLabel}</p><p>제출 당시 행사: {campaigns.find(c=>c.id===r.campaign_id)?.title??"행사 확인 필요"}</p><p>{r.document.reference}</p>{r.document.unknownReason&&<p>행사 미확인 사유: {r.document.unknownReason}</p>}<Link href={r.consultation_id?`/enrollment/${r.consultation_id}`:`/students/${r.student_id}?tab=hub`}>학생·상담 원본 확인 ↗</Link>
    {r.status==="submitted"?<><label>확정할 대표 행사<select value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">행사 확인 필요</option>{campaigns.map(c=><option key={c.id} value={c.id}>{c.start} · {channels[c.channel]} · {c.title}</option>)}</select></label>{campaign&&campaigns.find(c=>c.id===campaign)?.channel!==r.document.channel&&<p className={s.notice}>입력된 채널과 대표 행사의 채널이 다릅니다. 원문 응답을 보존하며, 확인 사유를 남겨 주세요.</p>}<label>확인 또는 보완 요청 사유<textarea value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label><nav><button type="button" disabled={busy||!campaign||note.trim().length<2} onClick={()=>review("approve")}>접점 확정</button><button type="button" disabled={busy||note.trim().length<2} onClick={()=>review("reject")}>보완 요청</button></nav></>:<p>확인 의견: {r.review_note}</p>}{message&&<p role="status">{message}</p>}
  </article>;
}
