"use client";

import { memo, useEffect, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { WeekView } from "../../derive";
import { formatMdW, formatRange } from "../../calendar";
import { nextChapterAfter, resolveDay, resolveWeek } from "../../focus";
import { quarterCurriculumLabel, TIMELINE_STATUS, type CurriculumPeriod } from "../../timeline-data";
import { useProgressMap } from "../map-state";
import styles from "./timeline.module.css";

export function CurriculumTimeline({ periods, activeMonth, expandedMonth, onExpand, onMonth, registerMonth }: {
  periods: CurriculumPeriod[]; activeMonth: number; expandedMonth: number | null;
  onExpand: (month: number) => void; onMonth: (month: number) => void;
  registerMonth: (month: number, element: HTMLElement | null) => void;
}) {
  const { sourceProgress, view } = useProgressMap();
  const year = periods[0]?.year ?? view.year;
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
  return <div className={styles.curriculum} ref={ref} aria-label={`${year}년 세로 커리큘럼`}>
    <div className={styles.timelineRail} aria-hidden><span style={{ height: fillHeight }} data-actual-rail /></div>
    {[1, 2, 3, 4].map((quarter) => {
      const months = periods.filter((period) => period.quarter === quarter);
      if (!months.length) return null;
      const done = months.filter((period) => period.status === "completed").length;
      const current = months.some((period) => period.isActual);
      return <section key={quarter} className={styles.quarter} data-current={current ? "true" : undefined} data-status={done === months.length ? "completed" : current ? "current" : months.every((month) => !month.isPast) ? "future" : "current"} aria-labelledby={`quarter-${year}-${quarter}`}>
        <header className={styles.quarterHeader}>
          <span className={styles.quarterNode} aria-hidden>{done === months.length ? "✓" : current ? "●" : "○"}</span>
          <div className={styles.quarterLabel}><h3 id={`quarter-${year}-${quarter}`}>{quarter}분기</h3><span>{(quarter - 1) * 3 + 1}~{quarter * 3}월</span></div>
          <div className={styles.quarterGoal}><strong>{quarterCurriculumLabel(months)}</strong><span>{done} / {months.length}개월 완료</span></div>
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
    data-month={period.month} data-period={period.id} data-viewed={active ? "true" : undefined} data-status={period.status} data-actual-month={period.isActual ? "true" : undefined}
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
  const { sourceProgress, view, mode, focus } = useProgressMap();
  const selectedMonth = period.year === view.year && period.month === focus.month;
  const selectedDay = selectedMonth && mode === "day" ? resolveDay(view, focus) : null;
  const selectedWeek = selectedMonth && (mode === "day" || mode === "week") ? resolveWeek(view, focus) : null;
  const weeks = period.source.weeks;
  const next = nextChapterAfter(sourceProgress);
  const book = sourceProgress.curriculum;
  return <div className={styles.monthDetail}>
    <section className={styles.dailySection} aria-label={`${period.month}월 상세 학습 내용`}>
      <h4>{selectedDay ? "선택한 날짜의 학습 내용" : selectedWeek ? "선택한 주의 학습 내용" : "주차별 학습 내용"}</h4>
      {weeks.map((week) => <WeekDetail key={week.index} period={period} week={week} automaticOpen={selectedWeek?.index === week.index} />)}
    </section>
    {period.isActual ? <section className={styles.bookDetail} aria-label="현재 교재 정보">
      <h4>현재 교재 정보</h4><strong>{book.bookName}</strong><p>{book.chapter}</p><b>p.{book.currentPage} / {book.totalPages}</b>
      {next ? <div className={styles.nextChapter}><span>다음 단원</span><strong>{next.chapter}</strong></div> : null}
    </section> : null}
  </div>;
}

function WeekDetail({ period, week, automaticOpen }: { period: CurriculumPeriod; week: WeekView; automaticOpen: boolean }) {
  const { mode, focus, selectDay, selectionRevision: scope } = useProgressMap();
  const selectedDate = mode === "day" ? focus.day : null;
  const [expansion, setExpansion] = useState({ scope, open: automaticOpen, includedDate: selectedDate });
  const current = expansion.scope === scope ? expansion : { scope, open: automaticOpen, includedDate: selectedDate };
  if (current !== expansion) setExpansion(current);
  const { open } = current;
  // 수업 없는 날을 선택해 표시한 행도 스크롤 중에는 유지해 목록 높이가 바뀌지 않게 한다.
  const days = week.days.filter((day) => day.record || day.isToday || day.date === current.includedDate);
  const noClass = week.days.every((day) => day.noClassReason);
  const detailId = `week-${period.id}-${week.index}`;
  return <section className={styles.weekSection} data-active-week={automaticOpen ? "true" : undefined} aria-label={`${period.month}월 ${week.index}주차 학습 내용`}>
    <h5><button type="button" className={styles.weekHeader} aria-expanded={open} aria-controls={detailId}
      onClick={() => setExpansion({ ...current, open: !open })}>
      <b>{week.index}주차</b><span>{formatRange(week.start, week.end)}</span>
      {week.plannedPages > 0 ? <strong>{week.donePages} / {week.plannedPages}쪽 · {week.pct}%</strong> : null}
      <EyIcon name={open ? "chevronUp" : "chevronDown"} size={14} />
    </button></h5>
    <div id={detailId} hidden={!open}>
      {days.length ? <ul>{days.map((day) => {
        const selected = day.date === selectedDate;
        const label = day.isToday ? "현재" : day.status === "completed" ? "완료" : day.status === "planned" ? "예정" : day.noClassReason ? "수업 없음" : "진행 중";
        return <li key={day.date} data-today={day.isToday ? "true" : undefined} data-selected-day={selected ? "true" : undefined}>
          <button type="button" onClick={() => selectDay(day.date)} aria-current={selected ? "date" : undefined} aria-label={`${formatMdW(day.date)} ${day.record?.subChapter || day.record?.chapter || "기록 없음"} ${label}`}>
            <span className={styles.dayState} data-status={day.isToday ? "current" : day.status}>{day.isToday ? "●" : day.status === "completed" ? "✓" : "○"}</span>
            <time>{formatMdW(day.date)}</time><span className={styles.dayTopic}>{day.record?.subChapter || day.record?.chapter || "기록 없음"}</span>
            <span className={styles.dayPages}>{day.plannedPages ? `p.${day.record!.startPage}–${day.record!.endPage}` : day.noClassReason || "—"}</span>
          </button>
        </li>;
      })}</ul> : <p className={styles.emptyDetail}>{noClass ? "수업이 없는 주입니다."
        : period.source.plannedPages > 0 ? "일별 학습 기록이 아직 없습니다." : "등록된 학습 계획이 없습니다."}</p>}
    </div>
  </section>;
}
