"use client";

import { useState, type FormEvent } from "react";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow } from "../types";
import { isVideoHomeworkDate } from "../types";
import type { LedgerChange } from "./use-ledger-marks";
import { RejectVideosButton } from "./reject-videos-button";
import { CancelHomeworkButton } from "./cancel-homework-button";
import styles from "./video-homework-management.module.css";

export const LEDGER_STATUS_OPTIONS = [{ value: "submitted", label: "완료" }, { value: "missing", label: "미수행" }, { value: "unchecked", label: "미확인" }] as const;
export type ActiveCell = { row: VideoHomeworkLedgerRow; round: LedgerRound; number: number };
export type SaveLedgerChanges = (changes: LedgerChange[]) => Promise<string[]>;
type EditorStatus = (typeof LEDGER_STATUS_OPTIONS)[number]["value"];

/** 칸 위 작은 글자 — 숙제가 나간 날(모르는 옛 기록은 검사한 날). */
export const roundDateText = (round: Pick<LedgerRound, "homeworkDate" | "date">) =>
  round.homeworkDate ? `숙제 ${round.homeworkDate}` : `검사 ${round.date}`;

/** 한 칸 편집 — 완료 날짜 고치기 · 미수행 · 미확인(기록 지우기). 영상으로 센 칸은 확정하거나 미수행으로 바꾼다. */
export function RoundEditor({ cell, today, busy, save, onClose, onAssign }: {
  cell: ActiveCell; today: string; busy: boolean; save: SaveLedgerChanges; onClose: () => void;
  onAssign?: () => void;
}) {
  const { row, round } = cell;
  const [status, setStatus] = useState<EditorStatus>(round.status);
  const [submittedDate, setSubmittedDate] = useState(round.submittedDate ?? (round.mark ? "" : today));
  const [error, setError] = useState("");
  const floor = round.homeworkDate ?? "2000-01-01";
  // 영상이 붙은 숙제 칸을 미확인으로 = 그 숙제의 영상 반려(원장 2026-10-13) — 기록 저장이 아니라 반려 버튼으로 한다.
  const rejecting = status === "unchecked" && !!round.videoId && !!round.homeworkDate;
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
    {round.auto ? <p className={styles.autoNote}>학부모 영상이 {round.videoDate}에 이 반으로 올라와 완료로 셉니다.</p>
      : round.videoDate ? <p className={styles.dim}>이 기록과 짝지은 학부모 영상: {round.videoDate}</p> : null}
    <div className={styles.statusOptions}>{LEDGER_STATUS_OPTIONS.map((option) => {
      // 영상이 붙은 칸의 미확인 = 영상 반려(아래 버튼). 숙제일 없는 옛 기록 칸은 종전대로 잠근다(반려할 숙제를 정할 수 없다).
      const locked = option.value === "unchecked" && !round.mark && round.auto && !round.homeworkDate;
      return <button key={option.value} type="button" disabled={busy || !row.editable || locked}
        title={locked ? "영상이 연결된 숙제입니다. 다른 숙제의 영상이면 영상 배정 변경에서 수정하세요." : undefined}
        aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>{option.label}</button>;
    })}</div>
    {status === "submitted" ? <label>제출일<input type="date" value={submittedDate} min={floor} max={today} required
      disabled={busy || !row.editable} onChange={(event) => { setSubmittedDate(event.target.value); setError(""); }} /></label> : null}
    {error ? <p role="alert" className={styles.red}>{error}</p> : null}
    {/* 영상이 없는 칸(미확인 · 미수행 · 손으로 찍은 '수동' 완료)에서도 연다 — 학생이 올린 영상을 그 숙제에 붙인다(원장 2026-10-14
        *"수동 영상들 다 학생들이 업로드해서 배정하고 싶은데 배정이 불가능함"*). 숙제일 없는 옛 기록(c:)은 붙일 숙제가 없고, 검사 대상 밖 줄은
        영상을 세지 않아 붙여도 보이지 않는다(rounds.ts ③ — tracked). */}
    {row.canAssignVideos && row.tracked && round.homeworkDate && onAssign ?<button type="button" className="text-primary w-fit text-sm underline" disabled={busy} onClick={onAssign}>
      {round.videoId ? "영상 배정 변경" : "이 숙제에 영상 배정"}</button> : null}
    {rejecting ? <RejectVideosButton classId={row.classId} studentId={row.studentId} homeworkDate={round.homeworkDate!} due={round.due} today={today}
      disabled={busy || !row.editable} onDone={onClose} /> : null}
    <p className={styles.dim}>{rejecting ? "다른 숙제에 올라간 영상이면 반려하지 말고 영상 배정 변경에서 옮겨 주세요."
      // 검사 기록 칸 · 옮겨 남긴 숙제는 붙은 영상이 손 '미수행'을 이긴다(rounds.ts) — 저장이 무시된 것처럼 보이지 않게 먼저 알린다(재리뷰 2026-10-14).
      : status === "missing" && round.videoId && !round.assigned ? "영상이 붙은 칸이라 미수행으로 저장해도 영상으로 완료로 셉니다. 다른 숙제의 영상이면 영상 배정 변경에서 옮기고, 잘못 올린 영상이면 미확인(영상 반려)으로 바꿔 주세요."
      : round.videoId ?"미확인은 수동 검사 기록만 지웁니다. 연결된 영상이 있으면 자동으로 완료됩니다. 영상 연결은 배정 변경에서 수정할 수 있습니다."
      : round.assigned ? "미확인으로 바꾸면 이 숙제의 검사 기록이 지워집니다."
      : round.homeworkDate ? "보고서에 영상 과제 표시가 없는 수업입니다. 미확인으로 바꿔도 이 칸은 남습니다."
      : "숙제일이 없는 옛 기록입니다. 미확인으로 바꾸면 기록이 지워져 이 회차가 장부에서 빠집니다."}</p>
    {rejecting ? null : row.editable ? <button type="submit" className={styles.primary} disabled={busy}>{busy ? "저장 중…" : "기록 저장"}</button>
      : <p className={styles.dim}>이 기록은 읽기 전용입니다.</p>}
    {/* 숙제 취소(원장 2026-10-16) — 저장된 상태가 미확인 · 미수행이고 영상이 붙지 않은 숙제 칸만. 보고서를 보낸 숙제도 여기서 거둔다. */}
    {row.editable && round.homeworkDate && round.status !== "submitted" && !round.videoId
      ? <CancelHomeworkButton classId={row.classId} studentId={row.studentId} homeworkDate={round.homeworkDate} disabled={busy} onDone={onClose} /> : null}
  </form>;
}
