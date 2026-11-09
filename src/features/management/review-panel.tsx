"use client";
import { useState, type FormEvent } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import { SAMPLE_SAVE_MESSAGE, sampleSave } from "@/features/mockup/sample";
import { latestReview, reviewLabels, reviewStatuses, type ReviewBatch } from "./reviews";
import s from "./workspace.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
const sourceLabel = (source: string) => source === "ecount" ? "ECOUNT 월별 손익 대사" : "MakeEdu 수납 대사";

/** 원본 대사·확인 업무 — 시안: 업로드·확인 기록 저장은 요청을 보내지 않고 안내 문구만 띄운다. */
export function ReviewPanel({ batches, month }: { batches: ReviewBatch[]; month: string }) {
  const latest = batches.filter((b, i) => batches.findIndex(x => x.source === b.source) === i);
  return <section id="reviews" className={s.panel}><div className={s.sectionTitle}><h2>{month} 원본 대사·확인 업무</h2><span>원본 → 차이 확인 → 담당·기한 → 조치 후 재검산</span></div>
    <p>원본 비교 결과와 확인 이력을 함께 관리합니다. 상태 변경은 청구 수정이나 회계 마감 확정을 대신하지 않습니다.</p>
    <details><summary>ECOUNT 월별손익분석으로 다시 대사하기</summary><p>같은 회사·월의 원장이 먼저 저장되어 있어야 합니다.</p><label>월별손익분석 엑셀 <input type="file" accept=".xlsx" disabled title={SAMPLE_SAVE_MESSAGE}/></label><p className={s.muted}>{SAMPLE_SAVE_MESSAGE}</p></details>
    {!latest.length ? <p>이 월에 저장된 원본 비교가 없습니다. 자료가 없다는 뜻이며 일치 판정이 아닙니다.</p> : null}
    {latest.map(batch => <article key={batch.id} className={s.reviewBatch}><h3>{sourceLabel(batch.source)}</h3><p>{batch.evidence.summary}</p><p className={s.muted}>확인 시각 {when(batch.evidence.observedAt)} · 당시 자료 기준</p>
      <div className={s.tableScroll}><table><thead><tr><th>항목</th><th>원본</th><th>에이와 집계</th><th>원본−에이와</th></tr></thead><tbody>{batch.evidence.facts.map(f => {
        const diff = f.sourceValue === null || f.aywaValue === null ? null : f.sourceValue - f.aywaValue;
        return <tr key={f.label}><td>{f.label}<small>{f.reference}</small></td><td>{f.sourceValue === null ? "비교 제외" : `${f.sourceValue.toLocaleString()}${f.unit}`}</td><td>{f.aywaValue === null ? "비교 제외" : `${f.aywaValue.toLocaleString()}${f.unit}`}</td><td className={diff ? s.warnText : undefined}>{diff === null ? "—" : `${diff.toLocaleString()}${f.unit}`}</td></tr>;
      })}</tbody></table></div>
      <p>{batch.evidence.issues.length}개 확인 항목 · 조치 뒤에는 원본을 다시 대사해 주세요.</p>
      {batch.evidence.issues.map(issue => <ReviewItem key={`${batch.id}:${issue.key}`} batch={batch} issue={issue}/>)}
      <details><summary>원본 근거</summary><p>{batch.evidence.sourceName}</p><p className={s.hash}>원본 SHA-256 {batch.evidence.sourceHash}</p><p className={s.hash}>비교 자료 SHA-256 {batch.evidence.comparedHash}</p></details>
    </article>)}
  </section>;
}

function ReviewItem({ batch, issue }: { batch: ReviewBatch; issue: ReviewBatch["evidence"]["issues"][number] }) {
  const current = latestReview(batch.events, issue.key), [message, setMessage] = useState("");
  const history = batch.events.filter(e => e.issue_key === issue.key);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage(await sampleSave()); }
  return <details className={s.reviewIssue}><summary><strong>{issue.title}</strong> <span>{reviewLabels[current?.status ?? "open"]}</span>{current?.owner ? ` · ${current.owner}` : ""}{current?.due_date ? ` · ${current.due_date}까지` : ""}</summary><p>{issue.detail}</p><p><strong>다음 확인:</strong> {issue.nextAction}</p>{issue.href ? <Link href={issue.href}>관련 업무 열기 →</Link> : null}
    <form onSubmit={e => void save(e)}><div className={s.inputs}><label>처리 상태<select name="status" defaultValue={current?.status ?? "open"}>{reviewStatuses.map(x => <option key={x} value={x}>{reviewLabels[x]}</option>)}</select></label><label>담당자<input name="owner" maxLength={80} defaultValue={current?.owner ?? ""}/></label><label>확인 기한<input name="dueDate" type="date" defaultValue={current?.due_date ?? ""}/></label></div><label className={s.reviewNote}>확인 내용·근거<textarea name="note" maxLength={2000} placeholder="확인한 원본·처리 내용과 남은 확인 사항"/></label><button>확인 기록 저장</button></form>
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
    {history.length ? <div className={s.reviewHistory}><strong>확인 이력</strong>{history.map(e => <p key={e.version}>v{e.version} · {reviewLabels[e.status]} · {e.owner || "담당 미지정"} · {when(e.created_at)}<br/>{e.note}</p>)}</div> : null}
  </details>;
}
