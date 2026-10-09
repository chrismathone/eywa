"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { roundSource, roundStatusLabel } from "../ledger";
import { BLANK_LABEL, type BlankCell } from "../no-homework";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow } from "../types";
import { roundDateText } from "./round-editor";
import styles from "./video-homework-management.module.css";

const shortDate = (date: string) => date.slice(5).replace("-", ".");
/** 완료 칸의 별도 재생 버튼. 수동은 누를 수 없는 표시다. */
function SourceMark({ row, round, videosKnown, onPlay }: { row: VideoHomeworkLedgerRow; round: LedgerRound; videosKnown: boolean; onPlay: () => void }) {
  const source = roundSource(round);
  // 🔴 영상 도착 기록을 못 읽었으면 영상 유무를 모른다 — 그때 '수동'은 거짓일 수 있어 띄우지 않는다.
  if (source === "manual") return videosKnown ? <span className={styles.manualTag} title="영상 없이 직접 찍은 완료(이 반으로 분류된 영상이 짝지어지지 않음)">수동</span> : null;
  if (source !== "video" || !round.videoId) return null;
  return <span className={styles.videoLink}>
    <button type="button" title={`${row.studentName} 숙제 영상 재생${round.auto ? " · 영상으로 자동 완료" : ""}`} aria-label="숙제 영상 보기"
      onClick={(event) => { event.stopPropagation(); onPlay(); }}>
      <EyIcon name="play" size={17} aria-hidden />
    </button>
  </span>;
}

/** 회차가 없는 칸 — 결석과 남는 칸은 '—', 숙제없음 사유만 날짜와 함께 표시한다. */
export function BlankRoundCell({ blank }: { blank: BlankCell | undefined }) {
  if (!blank || blank.reason === "absent") return <td><span className={styles.notApplicable} title="이 회차의 숙제가 없습니다" aria-label="숙제 없음">—</span></td>;
  const label = BLANK_LABEL[blank.reason];
  return <td><span className={styles.blank} title={`${blank.date} ${label} — 이 학생에겐 영상 숙제가 없었습니다`}
    aria-label={`${blank.date} ${label}`}>
    <small className={styles.markDate}>{shortDate(blank.date)}</small><span>{label}</span>
  </span></td>;
}

export function RoundCell({ row, round, blank, number, busy, videosKnown = true, onOpen, onPlay }: {
  row: VideoHomeworkLedgerRow; round: LedgerRound | undefined; blank?: BlankCell; number: number; busy: boolean; videosKnown?: boolean;
  onOpen: (round: LedgerRound) => void; onPlay: (round: LedgerRound) => void;
}) {
  if (!round) return <BlankRoundCell blank={blank} />;
  const label = roundStatusLabel(round);
  const source = roundSource(round);
  const tip = [roundDateText(round), label,
    round.submittedDate ? `제출 ${round.submittedDate}` : round.status === "submitted" ? "제출일이 기록되지 않은 완료" : null,
    round.videoDate ? `연결된 영상 게시일 ${round.videoDate}` : null,
    round.auto ? "영상으로 자동 완료" : null].filter(Boolean).join(" · ");
  return <td><div className={styles.cellWrap} data-source={source === "manual" && !videosKnown ? undefined : source ?? undefined}>
    <button type="button" className={`${styles.mark} ${styles[round.status]} ${round.auto ? styles.auto : ""}`} disabled={busy}
      aria-label={`${row.studentName} ${number}회 ${round.homeworkDate ?? round.date} ${label}`} title={tip} onClick={() => onOpen(round)}>
      <small className={styles.markDate}>{shortDate(round.date)}</small>
      <span className={styles.markStatus}>{round.status === "submitted"
        ? <><EyIcon name="check" size={12} aria-hidden /><span>{round.submittedDate ? shortDate(round.submittedDate) : "완료"}</span></>
        : round.status === "missing" ? "× 미수행" : "미확인"}</span>
    </button>
    <SourceMark row={row} round={round} videosKnown={videosKnown} onPlay={() => onPlay(round)} />
  </div></td>;
}
