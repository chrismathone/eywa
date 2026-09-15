"use client";

import { formatDotDate } from "../../calendar";
import { paceLabel } from "../../pace";
import type { CurriculumPeriod } from "../../timeline-data";
import { useProgressMap } from "../map-state";
import { CircularProgressClock } from "./circular-progress-clock";
import styles from "./timeline.module.css";

export function StickyProgressSidebar({ periods, onMonth, onDetail, onToday }: { periods: CurriculumPeriod[]; onMonth: (month: number) => void; onDetail: (month: number) => void; onToday: () => void }) {
  const { sourceProgress: actual, focus, pace } = useProgressMap();
  const book = actual.curriculum;
  const bookPct = book.totalPages > 0 ? Math.min(100, Math.round(book.currentPage / book.totalPages * 100)) : 0;
  return <>
    <CircularProgressClock periods={periods} activeMonth={focus.month} actualDate={actual.asOf} onMonth={onMonth} onDetail={onDetail} />
    <div className={styles.legend} aria-label="학습 상태 범례">
      <span><i data-status="completed" />완료</span><span><i data-status="current" />진행 중</span>
      <span><i data-status="future" />예정</span><span><i data-status="no-plan" />계획 없음</span>
    </div>
    <div className={styles.sidebarFacts}>
      <section className={styles.actualCard} aria-label="학생의 실제 현재 위치">
        <div className={styles.cardHeading}><h3><i className={styles.actualDot} />현재 위치</h3><time>{formatDotDate(actual.asOf)}</time></div>
        <strong>{book.bookName} · {book.chapter}</strong>
        <div className={styles.actualPages}><span>p.{book.currentPage} / {book.totalPages}</span><span>교재 진도 <b>{bookPct}%</b></span></div>
        <button type="button" onClick={onToday} className={styles.todayButton}>현재 단원으로 돌아가기 <span aria-hidden>→</span></button>
      </section>
      <section className={styles.paceCard} aria-label="계획 대비 실제 진도">
        <div className={styles.cardHeading}><h3>계획 대비</h3><strong className={styles.paceValue} data-pace={pace.status}>{paceLabel(pace)}</strong></div>
        <dl><dt>계획 위치</dt><dd>{pace.plannedChapter} <span>p.{pace.plannedPage}</span></dd>
          <dt>실제 위치</dt><dd>{pace.actualChapter} <span>p.{pace.actualPage}</span></dd></dl>
      </section>
    </div>
    <button type="button" onClick={onToday} className={styles.mobileToday}>TODAY {formatDotDate(actual.asOf)} · 현재 단원으로</button>
  </>;
}
