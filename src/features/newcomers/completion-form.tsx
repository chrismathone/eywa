"use client";
import { useState } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import type { Completion } from "./completion";
import css from "./completion-form.module.css";

/** 관리 콜·첫 적응 업무를 '실행한 액션 + 결과'와 함께 완료한다 — 체크만으로 끝내지 않는다(aywa-next 375d27df4). */
export function CompletionForm({ done, canWrite, busy, today, memo, consultationId, onSave }: { done: boolean; canWrite: boolean; busy: boolean; today: string; memo?: string | null; consultationId?: string | null; onSave: (done: boolean, completion?: Completion, doneOn?: string) => void }) {
  const [action, setAction] = useState(""), [result, setResult] = useState(""), [next, setNext] = useState(""), [date, setDate] = useState(today);
  return <div className={css.root}>
    {memo && <p className={css.memo}>{memo}</p>}
    {consultationId && <Link className={css.link} href={`/consultations/${consultationId}`}>연결된 상담 결과 보기 ↗</Link>}
    {done && !memo && !consultationId && <p className={css.muted}>이전 완료 기록입니다. 상세 결과 메모는 없습니다.</p>}
    {done ? <button type="button" className={css.secondary} disabled={!canWrite || busy} onClick={() => onSave(false)}>완료 취소</button> : <form className={css.form} onSubmit={(e) => { e.preventDefault(); onSave(true, { action, result, next }, date); }}><fieldset disabled={!canWrite || busy} className={css.form}>
      <label>수행일<input type="date" required max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label>실행한 액션<textarea required minLength={2} maxLength={80} value={action} onChange={(e) => setAction(e.target.value)} placeholder="예: 학부모에게 적응 상태 확인 전화" /></label>
      <label>처리 결과<textarea required minLength={2} maxLength={120} value={result} onChange={(e) => setResult(e.target.value)} placeholder="확인된 반응·해결 내용. 통화 미연결이면 완료 처리하지 말고 상담 후속 업무로 남겨 주세요." /></label>
      <label>다음 조치·기한 (선택)<input maxLength={60} value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <button type="submit" className={css.primary}>{busy ? "저장 중…" : "액션·결과 저장 후 완료"}</button>
    </fieldset></form>}
  </div>;
}
