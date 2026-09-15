"use client";

import { memo, useEffect, useRef, useState } from "react";
import { formatMdW } from "../../calendar";
import { nextChapterAfter, resolveDay, resolveWeek } from "../../focus";
import { QUARTER_GOALS, TIMELINE_STATUS, detailDays, type CurriculumPeriod } from "../../timeline-data";
import { useProgressMap } from "../map-state";
import styles from "./timeline.module.css";

export function CurriculumTimeline({ periods, activeMonth, expandedMonth, onExpand, onMonth, registerMonth }: {
  periods: CurriculumPeriod[]; activeMonth: number; expandedMonth: number | null;
  onExpand: (month: number) => void; onMonth: (month: number) => void;
  registerMonth: (month: number, element: HTMLElement | null) => void;
}) {
  const { sourceProgress, view } = useProgressMap();
  const ref = useRef<HTMLDivElement>(null);
  const [fillHeight, setFillHeight] = useState(0);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const actual = root.querySelector<HTMLElement>('[data-actual-month="true"] [data-month-node]');
      setFillHeight(actual ? actual.getBoundingClientRect().top + actual.offsetHeight / 2 - root.getBoundingClientRect().top
        : periods.length > 0 && periods.every((period) => period.isPast) ? root.offsetHeight : 0);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root); measure();
    return () => observer.disconnect();
  }, [view.year, sourceProgress.asOf, expandedMonth, periods]);
  return <div className={styles.curriculum} ref={ref} aria-label={`${view.year}년 세로 커리큘럼`}>
    <div className={styles.timelineRail} aria-hidden><span style={{ height: fillHeight }} data-actual-rail /></div>
    {[1, 2, 3, 4].map((quarter) => {
      const months = periods.filter((period) => period.quarter === quarter);
      if (!months.length) return null;
      const done = months.filter((period) => period.status === "completed").length;
      const current = months.some((period) => period.isActual);
      return <section key={quarter} className={styles.quarter} data-current={current ? "true" : undefined} data-status={done === months.length ? "completed" : current ? "current" : months.every((month) => !month.isPast) ? "future" : "current"} aria-labelledby={`quarter-${view.year}-${quarter}`}>
        <header className={styles.quarterHeader}>
          <span className={styles.quarterNode} aria-hidden>{done === months.length ? "✓" : current ? "●" : "○"}</span>
          <div className={styles.quarterLabel}><h3 id={`quarter-${view.year}-${quarter}`}>{quarter}분기</h3><span>{(quarter - 1) * 3 + 1}~{quarter * 3}월</span></div>
          <div className={styles.quarterGoal}><strong>{QUARTER_GOALS[quarter - 1]}</strong><span>{done} / {months.length}개월 완료</span></div>
        </header>
        {months.map((period) => <MonthProgressItem key={period.id} period={period} active={period.month === activeMonth}
          expanded={period.month === expandedMonth} onExpand={onExpand} onMonth={onMonth} registerMonth={registerMonth} />)}
      </section>;
    })}
  </div>;
}

const MonthProgressItem = memo(function MonthProgressItem({ period, active, expanded, onExpand, onMonth, registerMonth }: {
  period: CurriculumPeriod; active: boolean; expanded: boolean; onExpand: (month: number) => void; onMonth: (month: number) => void;
  registerMonth: (month: number, element: HTMLElement | null) => void;
}) {
  const status = TIMELINE_STATUS[period.status];
  return <article ref={(element) => registerMonth(period.month, element)} className={styles.monthItem}
    data-month={period.month} data-viewed={active ? "true" : undefined} data-status={period.status} data-actual-month={period.isActual ? "true" : undefined}
    aria-label={`${period.month}월 ${period.chapter}`}>
    <span className={styles.monthNode} data-month-node aria-hidden />
    <div className={styles.monthMeta}>
      <button type="button" onClick={() => onMonth(period.month)} aria-current={active ? "date" : undefined}>{period.month}월</button>
      {period.isActual ? <span className={styles.todayBadge} role="img" aria-label={`${status.label} · 오늘`}>TODAY</span> : <span className={styles.statusSymbol} role="img" aria-label={status.label}>{status.symbol}</span>}
    </div>
    <div className={styles.monthBody}>
      <button type="button" className={styles.monthSummary} onClick={() => onExpand(period.month)} aria-expanded={expanded} aria-controls={`detail-${period.id}`}>
        <span className={styles.monthTitle}><strong>{period.semester || period.bookName} <span>{period.chapter}</span></strong>
          <span className={styles.subChapter}>{period.subChapter || period.bookName}</span></span>
        <span className={styles.monthProgress}>
          <span className={styles.unitCount}>{period.totalUnits > 0 ? `${period.completedUnits} / ${period.totalUnits} 학습 항목` : `${period.source.donePages} / ${period.source.plannedPages}쪽`}</span>
          <span className={styles.progressTrack} aria-hidden><i style={{ width: `${period.progress}%` }} /></span>
          <b>{period.status === "no-plan" ? "—" : `${period.progress}%`}</b>
        </span>
        <span className={styles.expandIcon} aria-hidden>{expanded ? "⌃" : "›"}</span>
      </button>
      <div id={`detail-${period.id}`} hidden={!expanded}>{expanded ? <MonthDetail period={period} /> : null}</div>
    </div>
  </article>;
});

function MonthDetail({ period }: { period: CurriculumPeriod }) {
  const { sourceProgress, view, mode, focus, selectDay } = useProgressMap();
  const days = mode === "day" ? [resolveDay(view, focus)] : mode === "week" ? resolveWeek(view, focus).days.filter((day) => day.record || day.isToday)
    : mode === "month" ? period.source.weeks.flatMap((week) => week.days).filter((day) => day.record)
      : detailDays(period, sourceProgress.asOf);
  const next = nextChapterAfter(sourceProgress);
  const book = sourceProgress.curriculum;
  return <div className={styles.monthDetail}>
    <section className={styles.dailySection} aria-label={`${period.month}월 상세 학습 내용`}>
      <h4>{mode === "day" ? "선택한 날짜의 학습 내용" : mode === "month" ? "월별 학습 내용" : period.isActual ? "이번 주 학습 내용" : "학습 기록"}</h4>
      {days.length ? <ul>{days.map((day) => {
        const label = day.isToday ? "현재" : day.status === "completed" ? "완료" : day.status === "planned" ? "예정" : day.noClassReason ? "수업 없음" : "진행 중";
        return <li key={day.date} data-today={day.isToday ? "true" : undefined}>
          <button type="button" onClick={() => selectDay(day.date)} aria-label={`${formatMdW(day.date)} ${day.record?.subChapter || day.record?.chapter || "기록 없음"} ${label}`}>
            <span className={styles.dayState} data-status={day.isToday ? "current" : day.status}>{day.isToday ? "●" : day.status === "completed" ? "✓" : "○"}</span>
            <time>{formatMdW(day.date)}</time><span className={styles.dayTopic}>{day.record?.subChapter || day.record?.chapter || "기록 없음"}</span>
            <span className={styles.dayPages}>{day.plannedPages ? `p.${day.record!.startPage}–${day.record!.endPage}` : day.noClassReason || "—"}</span>
          </button>
        </li>;
      })}</ul> : <p className={styles.emptyDetail}>{period.source.plannedPages > 0 ? "일별 학습 기록이 아직 없습니다." : "등록된 학습 계획이 없습니다."}</p>}
    </section>
    {period.isActual ? <section className={styles.bookDetail} aria-label="현재 교재 정보">
      <h4>현재 교재 정보</h4><strong>{book.bookName}</strong><p>{book.chapter}</p><b>p.{book.currentPage} / {book.totalPages}</b>
      {next ? <div className={styles.nextChapter}><span>다음 단원</span><strong>{next.chapter}</strong></div> : null}
    </section> : null}
  </div>;
}
