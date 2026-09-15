"use client";

import { useCallback, useMemo, useState } from "react";
import { Toolbar, ToolbarRow, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { monthPosition } from "../../continuous-timeline";
import { curriculumPeriods } from "../../timeline-data";
import { VIEW_MODE_LABEL, type ViewMode } from "../../model";
import { useProgressMap } from "../map-state";
import { CurriculumTimeline } from "./curriculum-timeline";
import { StickyProgressSidebar } from "./timeline-sidebar";
import { useTimelineScrollSpy } from "./use-timeline-scroll-spy";
import styles from "./timeline.module.css";

const PERIODS: ViewMode[] = ["year", "quarter", "month", "week", "day"];

export function MathProgressTimeline() {
  const { view, focus, sourceProgress, years, mode, setMode, currentProgressPosition, setViewedPosition, selectYear } = useProgressMap();
  const actualMonth = Number(sourceProgress.asOf.slice(5, 7));
  const [expandedMonth, setExpandedMonth] = useState<number | null>(view.year === Number(sourceProgress.asOf.slice(0, 4)) ? actualMonth : null);
  const periods = useMemo(() => curriculumPeriods(view, sourceProgress), [view, sourceProgress]);
  const visiblePeriods = mode === "quarter" ? periods.filter((period) => period.quarter === Math.ceil(focus.month / 3))
    : ["month", "week", "day"].includes(mode) ? periods.filter((period) => period.month === focus.month) : periods;
  const scopeKey = `${view.year}:${mode}:${visiblePeriods.map((period) => period.month).join(",")}`;
  const { layoutRef, sidebarRef, registerMonth, navigateMonth, navigatePosition, programmaticScroll } = useTimelineScrollSpy(currentProgressPosition, setViewedPosition, scopeKey);
  const onExpand = useCallback((month: number) => { setExpandedMonth((value) => value === month ? null : month); }, []);
  const onToday = () => {
    setMode("year");
    setExpandedMonth(actualMonth);
    navigatePosition(monthPosition(Number(sourceProgress.asOf.slice(0, 4)), actualMonth));
  };
  return <div className={styles.timelineTheme}>
    <Toolbar rail={false}>
      <ToolbarRow><ToolbarSegment title="진도 보기 단위">
        {PERIODS.map((period) => <ToolbarSegmentItem key={period} active={mode === period} onClick={() => {
          setMode(period); if (period !== "year") setExpandedMonth(focus.month);
        }}>{VIEW_MODE_LABEL[period]}</ToolbarSegmentItem>)}
      </ToolbarSegment></ToolbarRow>
      <ToolbarRow><ToolbarSegment label="연도" title="커리큘럼 연도">
        {years.map((year) => <ToolbarSegmentItem key={year} active={view.year === year} onClick={() => {
          setMode("year"); setExpandedMonth(year === Number(sourceProgress.asOf.slice(0, 4)) ? actualMonth : null); selectYear(year);
        }}>{year}년</ToolbarSegmentItem>)}
      </ToolbarSegment></ToolbarRow>
    </Toolbar>
    <div className={styles.progressLayout} ref={layoutRef} data-vertical-timeline data-viewed-position={currentProgressPosition} data-programmatic-scroll={programmaticScroll ? "true" : "false"}>
      <aside className={styles.sidebar} ref={sidebarRef} aria-label="고정 수학 진도 시계">
        <StickyProgressSidebar periods={periods} onMonth={navigateMonth} onDetail={setExpandedMonth} onToday={onToday} />
      </aside>
      <div className={styles.timelineColumn}>
        <header className={styles.curriculumHeader}><div><h2>{view.year}년 수학 커리큘럼</h2><p>스크롤로 지난 학습부터 다음 과정까지 살펴보세요.</p></div>
          <div className={styles.yearGoal}><span>올해 진도</span><strong>{view.pct}%</strong><span>{view.donePages} / {view.plannedPages}쪽</span></div>
        </header>
        <CurriculumTimeline periods={visiblePeriods} activeMonth={focus.month} expandedMonth={expandedMonth} onExpand={onExpand} onMonth={navigateMonth} registerMonth={registerMonth} />
      </div>
    </div>
  </div>;
}
