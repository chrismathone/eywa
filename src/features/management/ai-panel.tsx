"use client";
import { useState } from "react";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import type { AiReview } from "./ai-answer";
import type { Metric } from "./model";
import s from "./workspace.module.css";

const when = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

/**
 * AI 경영 검토 — 🔴 버튼을 누를 때만 부른다. 마지막 결과는 DB(s2_0054)에 남아 '다시 검토'를 누르기 전까지 그대로 보인다.
 * AI에 보내는 것 = 그 달 집계 지표·산식뿐(이름·상담 원문·개인별 급여 없음).
 */
export function AiReviewPanel({ month, metrics, initial }: { month: string; metrics: Metric[]; initial: AiReview | null }) {
  const [review, setReview] = useState(initial), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function analyze() {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/management/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) }), json = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(json.error ?? "AI 검토를 완료하지 못했습니다");
      setReview(json.review);
    } catch (e) { setMessage(e instanceof Error ? e.message : "AI 검토를 완료하지 못했습니다"); } finally { setBusy(false); }
  }
  const label = review ? modelDisplayLabel(review.model) : null;
  return <>
    <h3>AI 경영 검토</h3>
    <p>버튼을 누르면 개인별 이름·상담 원문·개인별 급여 없이 {month} 집계 지표와 산식만 AI에 보냅니다. AI의 설명은 검토용이며, 실제 업무 변경은 담당자가 결정합니다.</p>
    <button disabled={busy} onClick={() => void analyze()}>{busy ? "근거 검토 중…" : review ? "현재 지표로 다시 검토" : "현재 지표로 AI 검토"}</button>
    {message ? <p role="status" className={s.notice}>{message}</p> : null}
    {review ? <div className={s.answer}>
      <p className={s.muted}>{when(review.createdAt)} 검토{label ? ` · ${label}` : ""} · {when(review.factsObservedAt)} 기준 지표</p>
      <p>{review.answer.summary}</p>
      {review.answer.findings.map((f, i) => <article key={i}><strong>{f.kind}: {f.statement}</strong><p>{f.nextAction}</p><p className={s.muted}>근거 지표 · {f.metricIds.map(id => metrics.find(m => m.id === id)?.label ?? "지표").join(" · ")}</p></article>)}
      {review.answer.missingData.length ? <><h4>추가로 필요한 자료</h4><ul>{review.answer.missingData.map((m, i) => <li key={i}>{m}</li>)}</ul></> : null}
    </div> : null}
  </>;
}
