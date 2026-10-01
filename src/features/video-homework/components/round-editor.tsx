"use client";

import { useState, type FormEvent } from "react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow } from "../types";
import { isVideoHomeworkDate } from "../types";
import type { LedgerChange } from "./use-ledger-marks";
import styles from "./video-homework-management.module.css";

export const LEDGER_STATUS_OPTIONS = [{ value: "submitted", label: "완료" }, { value: "missing", label: "미수행" }, { value: "unchecked", label: "미확인" }] as const;
export type ActiveCell = { row: VideoHomeworkLedgerRow; round: LedgerRound; number: number };
export type SaveLedgerChanges = (changes: LedgerChange[]) => Promise<string[]>;
type EditorStatus = (typeof LEDGER_STATUS_OPTIONS)[number]["value"];

/** 칸 위 작은 글자 — 숙제가 나간 날(모르는 옛 기록은 검사한 날). */
export const roundDateText = (round: Pick<LedgerRound, "homeworkDate" | "date">) =>
  round.homeworkDate ? `숙제 ${round.homeworkDate}` : `검사 ${round.date}`;

/** 한 칸 편집 — 완료 날짜 고치기 · 미수행 · 미확인(기록 지우기). 영상으로 센 칸은 확정하거나 미수행으로 바꾼다. */
export function RoundEditor({ cell, today, busy, save, onClose }: {
  cell: ActiveCell; today: string; busy: boolean; save: SaveLedgerChanges; onClose: () => void;
}) {
  const { row, round } = cell;
  const [status, setStatus] = useState<EditorStatus>(round.status);
  const [submittedDate, setSubmittedDate] = useState(round.submittedDate ?? (round.mark ? "" : today));
  const [error, setError] = useState("");
  const floor = round.homeworkDate ?? "2000-01-01";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!row.editable || busy) return;
    if (status === "submitted" && (!isVideoHomeworkDate(submittedDate) || submittedDate > today || submittedDate < floor)) {
      setError(`제출일은 ${round.homeworkDate ? "숙제가 나간 날부터 " : ""}오늘까지의 올바른 날짜로 입력해 주세요.`); return;
    }
    setError("");
    // 기록이 없는 칸을 미확인으로 두는 것은 바꿀 것이 없다.
    if (status === "unchecked" && !round.mark) { onClose(); return; }
    const failed = await save([{ classId: row.classId, studentId: row.studentId, round,
      status: status === "unchecked" ? null : status, submittedDate: status === "submitted" ? submittedDate : null }]);
    if (!failed.length) onClose();
  }
  return <form className={styles.editor} onSubmit={(event) => void submit(event)}>
    <DialogHeader><DialogTitle>{row.studentName} · {cell.number}회</DialogTitle>
      <DialogDescription>{row.className} · {roundDateText(round)}</DialogDescription></DialogHeader>
    {round.auto ? <p className={styles.autoNote}>학부모 영상이 {round.videoDate}에 이 반으로 올라와 완료로 셉니다. 저장하면 직접 확인한 기록으로 남습니다.</p>
      : round.videoDate ? <p className={styles.dim}>이 기록과 짝지은 학부모 영상: {round.videoDate}</p> : null}
    <div className={styles.statusOptions}>{LEDGER_STATUS_OPTIONS.map((option) => {
      // 영상으로 센 칸은 저장된 기록이 없어 '미확인'으로 되돌릴 것이 없다 — 이 반 숙제 영상이 아니면 미수행으로 남긴다.
      const locked = option.value === "unchecked" && !round.mark && round.auto;
      return <button key={option.value} type="button" disabled={busy || !row.editable || locked}
        title={locked ? "영상 도착으로 센 칸입니다. 이 숙제 영상이 아니면 미수행으로 기록하세요." : undefined}
        aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>;
    })}</div>
    {status === "submitted" ? <label>제출일<input type="date" value={submittedDate} min={floor} max={today} required
      disabled={busy || !row.editable} onChange={(event) => { setSubmittedDate(event.target.value); setError(""); }} /></label> : null}
    {error ? <p role="alert" className={styles.red}>{error}</p> : null}
    <p className={styles.dim}>{round.assigned ? "미확인으로 바꾸면 이 숙제의 검사 기록이 지워집니다."
      : "보고서에 영상 과제 표시가 없는 기록입니다. 미확인으로 바꾸면 기록이 지워져 이 회차가 장부에서 빠집니다."}</p>
    {row.editable ? <button type="submit" className={styles.primary} disabled={busy}>{busy ? "저장 중…" : "기록 저장"}</button>
      : <p className={styles.dim}>이 기록은 읽기 전용입니다.</p>}
  </form>;
}
