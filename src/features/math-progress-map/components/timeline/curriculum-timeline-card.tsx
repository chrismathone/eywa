"use client";

import { useMemo, useState } from "react";
import { curriculumPeriods } from "../../timeline-data";
import { VIEW_MODE_LABEL, type ViewMode } from "../../model";
import { useProgressMap } from "../map-state";
import { CurriculumTimeline } from "./curriculum-timeline";
import { useTimelineScrollSpy } from "./use-timeline-scroll-spy";
import styles from "./timeline.module.css";

/** 기존 원형 지도 우측 요약 카드 안에 들어가는 고정 높이 커리큘럼 스크롤. */
export function CurriculumTimelineCard() {
  const { view, focus, sourceProgress, mode, currentProgressPosition, setViewedPosition } = useProgressMap();
  const actualMonth = Number(sourceProgress.asOf.slice(5, 7));
  const periods = useMemo(() => curriculumPeriods(view, sourceProgress), [view, sourceProgress]);
  const visible = mode === "quarter" ? periods.filter((period) => period.quarter === Math.ceil(focus.month / 3))
    : ["month", "week", "day"].includes(mode) ? periods.filter((period) => period.month === focus.month) : periods;
  const [expandedMonth, setExpandedMonth] = useState<number | null>(actualMonth);
  const scopeKey = `card:${view.year}:${mode}:${visible.map((period) => period.month).join(",")}`;
  const { layoutRef, navigateMonth, registerMonth, programmaticScroll } = useTimelineScrollSpy(currentProgressPosition, setViewedPosition, scopeKey);
  return <section className={styles.timelineCard} aria-label={`${view.year}년 진도 요약`}>
    <header className={styles.timelineCardHeader}>
      <div><h2>{view.year}년 진도 요약</h2><p>오른쪽 영역만 스크롤해 월별 진도를 확인하세요.</p></div>
      <span>{VIEW_MODE_LABEL[mode as ViewMode]}</span>
    </header>
    <div className={styles.timelineCardScroll}>
      <div ref={layoutRef} data-timeline-card-layout data-viewed-position={currentProgressPosition} data-programmatic-scroll={programmaticScroll ? "true" : "false"}>
        <CurriculumTimeline periods={visible} activeMonth={focus.month} expandedMonth={expandedMonth}
          onExpand={(month) => setExpandedMonth((value) => value === month ? null : month)}
          onMonth={navigateMonth} registerMonth={registerMonth} />
      </div>
    </div>
  </section>;
}
