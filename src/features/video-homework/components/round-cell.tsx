"use client";

import { EyIcon } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { roundSource, roundStatusLabel } from "../ledger";
import { BLANK_LABEL, type BlankCell } from "../no-homework";
import type { LedgerRound } from "../rounds";
import type { VideoHomeworkLedgerRow } from "../types";
import { roundDateText } from "./round-editor";
import styles from "./video-homework-management.module.css";

const shortDate = (date: string) => date.slice(5).replace("-", ".");
/** 학생 상세 '숙제 영상' 탭 — `video`로 그 영상을 미리 골라 연다(뷰어가 없는 id는 무시). */
export const homeworkVideoHref = (studentId: string, videoId: string) =>
  `/students/${encodeURIComponent(studentId)}?tab=homework-videos&video=${encodeURIComponent(videoId)}`;

/** 완료 칸 모서리 표시 — 영상이 짝지어졌으면 ▶(누르면 그 학생의 숙제 영상 탭으로), 영상 없이 사람이 찍었으면 '수동'(누를 수 없음). */
function SourceMark({ row, round, videosKnown }: { row: VideoHomeworkLedgerRow; round: LedgerRound; videosKnown: boolean }) {
  const source = roundSource(round);
  // 🔴 영상 도착 기록을 못 읽었으면 영상 유무를 모른다 — 그때 '수동'은 거짓일 수 있어 띄우지 않는다.
  if (source === "manual") return videosKnown ? <span className={styles.manualTag} title="영상 없이 직접 찍은 완료(이 반으로 분류된 영상이 짝지어지지 않음)">수동</span> : null;
  if (source !== "video" || !round.videoId) return null;
  return <span className={styles.videoLink} onClick={(event) => event.stopPropagation()}>
    <WindowLink href={homeworkVideoHref(row.studentId, round.videoId)} title={`${row.studentName} 숙제 영상`} ariaLabel="숙제 영상 보기">
      <EyIcon name="play" size={12} aria-hidden />
    </WindowLink>
  </span>;
}

/** 회차가 없는 칸 — 결석·숙제없음 사유가 있으면 "MM.DD 결석", 그날 수강생이 아니었거나 사유를 모르면 '—'. */
export function BlankRoundCell({ blank }: { blank: BlankCell | undefined }) {
  if (!blank) return <td><span className={styles.notApplicable} title="이 회차의 숙제가 없습니다" aria-label="숙제 없음">—</span></td>;
  const label = BLANK_LABEL[blank.reason];
  return <td><span className={styles.blank} title={`${blank.date} ${label}${blank.reason === "absent" ? " — 결석이라 숙제 회차에 넣지 않습니다" : " — 이 학생에겐 영상 숙제가 없었습니다"}`}
    aria-label={`${blank.date} ${label}`}>
    <small className={styles.markDate}>{shortDate(blank.date)}</small><span>{label}</span>
  </span></td>;
}

export function RoundCell({ row, round, blank, number, busy, videosKnown = true, onOpen }: {
  row: VideoHomeworkLedgerRow; round: LedgerRound | undefined; blank?: BlankCell; number: number; busy: boolean; videosKnown?: boolean; onOpen: (round: LedgerRound) => void;
}) {
  if (!round) return <BlankRoundCell blank={blank} />;
  const label = roundStatusLabel(round);
  const tip = [roundDateText(round), label, round.submittedDate ? `제출 ${round.submittedDate}` : null,
    round.auto ? `이 반으로 올라온 학부모 영상 ${round.videoDate} — 자동으로 셈` : null].filter(Boolean).join(" · ");
  return <td><div className={styles.cellWrap}>
    <button type="button" className={`${styles.mark} ${styles[round.status]} ${round.auto ? styles.auto : ""}`} disabled={busy}
      aria-label={`${row.studentName} ${number}회 ${round.homeworkDate ?? round.date} ${label}`} title={tip} onClick={() => onOpen(round)}>
      <small className={styles.markDate}>{shortDate(round.date)}</small>
      <span>{round.status === "submitted"
        ? <>{round.auto ? <span className={styles.autoTag}>영상</span> : <EyIcon name="check" size={12} className="inline-block align-middle" />} {round.submittedDate ? shortDate(round.submittedDate) : "완료"}</>
        : round.status === "missing" ? "× 미수행" : "미확인"}</span>
    </button>
    <SourceMark row={row} round={round} videosKnown={videosKnown} />
  </div></td>;
}
