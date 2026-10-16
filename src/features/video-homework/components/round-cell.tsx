"use client";

import type { MouseEvent } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { roundSource, roundStatusLabel } from "../ledger";
import { BLANK_LABEL, type BlankCell } from "../no-homework";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow } from "../types";
import { roundDateText } from "./round-editor";
import styles from "./video-homework-management.module.css";

const shortDate = (date: string) => date.slice(5).replace("-", ".");
/** 칸에서 메뉴를 연다 — 숙제없음 칸은 '숙제 출제', 따로 낸 숙제 칸은 '출제 취소'(issue-menu.tsx). */
export type OpenIssueMenu = (kind: "issue" | "cancel", date: string, at: { x: number; y: number }) => void;
const pointOf = (event: MouseEvent<HTMLElement>) => {
  // 키보드로 연 메뉴(좌표 0,0)는 칸 자리에 띄운다.
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const box = event.currentTarget.getBoundingClientRect();
  return { x: box.left, y: box.bottom };
};
/** 완료 칸의 별도 재생 버튼. 수동은 누를 수 없는 표시다. 우클릭은 칸과 같이 편집 창(`onEditor` — 영상 칸을 ▶ 위에서 우클릭하는 일이 많다). */
function SourceMark({ row, round, videosKnown, onPlay, onEditor }: { row: VideoHomeworkLedgerRow; round: LedgerRound; videosKnown: boolean; onPlay: () => void;
  onEditor?: (event: MouseEvent<HTMLElement>) => void }) {
  const source = roundSource(round);
  // 🔴 영상 도착 기록을 못 읽었으면 영상 유무를 모른다 — 그때 '수동'은 거짓일 수 있어 띄우지 않는다.
  if (source === "manual") return videosKnown ? <span className={styles.manualTag} title="영상 없이 직접 찍은 완료(이 반으로 분류된 영상이 짝지어지지 않음)">수동</span> : null;
  if (source !== "video" || !round.videoId) return null;
  return <span className={styles.videoLink}>
    <button type="button" title={`${row.studentName} 숙제 영상 재생${round.auto ? " · 영상으로 자동 완료" : ""}`} aria-label="숙제 영상 보기"
      onClick={(event) => { event.stopPropagation(); onPlay(); }} onContextMenu={onEditor}>
      <EyIcon name="play" size={17} aria-hidden />
    </button>
  </span>;
}

/**
 * 회차가 없는 칸 — 결석과 남는 칸은 '—', 숙제없음 사유만 날짜와 함께 표시한다.
 * 고칠 수 있는 줄의 숙제없음 칸은 **우클릭(또는 누르기)으로 그 날짜의 숙제를 낸다**(원장 2026-10-13) — 터치 화면엔 우클릭이 없어 누르기도 같은 메뉴를 연다.
 */
export function BlankRoundCell({ blank, onMenu }: { blank: BlankCell | undefined; onMenu?: OpenIssueMenu }) {
  if (!blank || blank.reason === "absent") return <td><span className={styles.notApplicable} title="이 회차의 숙제가 없습니다" aria-label="숙제 없음">—</span></td>;
  const label = BLANK_LABEL[blank.reason];
  const body = <><small className={styles.markDate}>{shortDate(blank.date)}</small><span>{label}</span></>;
  if (!onMenu) return <td><span className={styles.blank} title={`${blank.date} ${label} — 이 학생에겐 영상 숙제가 없었습니다`}
    aria-label={`${blank.date} ${label}`}>{body}</span></td>;
  const open = (event: MouseEvent<HTMLElement>) => { event.preventDefault(); onMenu("issue", blank.date, pointOf(event)); };
  return <td><button type="button" className={`${styles.blank} ${styles.blankAction}`} aria-haspopup="menu"
    title={`${blank.date} ${label} — 우클릭하면 이 날짜의 영상 숙제를 낼 수 있습니다`} aria-label={`${blank.date} ${label}`}
    onClick={open} onContextMenu={open}>{body}</button></td>;
}

export function RoundCell({ row, round, blank, number, busy, videosKnown = true, onOpen, onEditor, onPlay, onMenu }: {
  row: VideoHomeworkLedgerRow; round: LedgerRound | undefined; blank?: BlankCell; number: number; busy: boolean; videosKnown?: boolean;
  onOpen: (round: LedgerRound) => void; onPlay: (round: LedgerRound) => void;
  /**
   * 우클릭 = 칸 편집 창(원장 2026-10-15 — 영상이 붙은 칸을 우클릭해 배정을 찾았다). 누르기와 달리 **저장하지 않는다**(미확인 칸을 누르면
   * 오늘로 완료가 찍히지만 우클릭은 창만 연다). 따로 낸 숙제의 '출제 취소' 메뉴가 서는 칸은 그 메뉴가 먼저다.
   */
  onEditor?: (round: LedgerRound) => void;
  /** 고칠 수 있는 줄에서만 준다 — 숙제없음 칸의 '숙제 출제' · 따로 낸 숙제 칸의 '출제 취소'. */
  onMenu?: OpenIssueMenu;
}) {
  if (!round) return <BlankRoundCell blank={blank} onMenu={onMenu} />;
  const label = roundStatusLabel(round);
  const source = roundSource(round);
  // 보고서 없이 따로 낸 숙제 — 점선으로 가르고, 영상이 붙지 않은 미확인·미수행 칸은 우클릭으로 거둘 수 있다(`cancel-homework.ts` — 완료로 찍힌 칸은 서버가 거절한다).
  const extra = !!round.homeworkDate && !!row.extraDates?.includes(round.homeworkDate);
  const cancellable = extra && !!onMenu && round.status !== "submitted" && !round.videoId;
  const openEditor = onEditor ? (event: MouseEvent<HTMLElement>) => { event.preventDefault(); if (!busy) onEditor(round); } : undefined;
  const tip = [roundDateText(round), label,
    round.submittedDate ? `제출 ${round.submittedDate}` : round.status === "submitted" ? "제출일이 기록되지 않은 완료" : null,
    round.videoDate ? `연결된 영상 게시일 ${round.videoDate}` : null,
    round.auto ? "영상으로 자동 완료" : null,
    extra ? `수업보고서 없이 따로 낸 숙제${cancellable ? " · 우클릭하면 취소할 수 있습니다" : ""}` : null].filter(Boolean).join(" · ");
  return <td><div className={styles.cellWrap} data-source={source === "manual" && !videosKnown ? undefined : source ?? undefined}>
    <button type="button" className={`${styles.mark} ${styles[round.status]} ${round.auto ? styles.auto : ""}`} disabled={busy} data-extra={extra || undefined}
      aria-label={`${row.studentName} ${number}회 ${round.homeworkDate ?? round.date} ${label}${extra ? " · 따로 낸 숙제" : ""}`} title={tip} onClick={() => onOpen(round)}
      onContextMenu={cancellable ? (event) => { event.preventDefault(); onMenu("cancel", round.homeworkDate!, pointOf(event)); } : openEditor}>
      <small className={styles.markDate}>{shortDate(round.date)}</small>
      <span className={styles.markStatus}>{round.status === "submitted"
        ? <><EyIcon name="check" size={12} aria-hidden /><span>{round.submittedDate ? shortDate(round.submittedDate) : "완료"}</span></>
        : round.status === "missing" ? "× 미수행" : "미확인"}</span>
    </button>
    <SourceMark row={row} round={round} videosKnown={videosKnown} onPlay={() => onPlay(round)} onEditor={openEditor} />
  </div></td>;
}
