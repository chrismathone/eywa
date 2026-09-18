"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { curriculumPeriods } from "../../timeline-data";
import { buildYearView } from "../../derive";
import { monthPosition, timelineRange } from "../../continuous-timeline";
import { progressForYear } from "../../years";
import { VIEW_MODE_LABEL, type ViewMode } from "../../model";
import { useProgressMap } from "../map-state";
import { CurriculumTimeline } from "./curriculum-timeline";
import { useTimelineScrollSpy } from "./use-timeline-scroll-spy";
import { useExpandedMonth } from "./use-expanded-month";
import styles from "./timeline.module.css";

/** 기존 원형 지도 우측 요약 카드 안에 들어가는 고정 높이 커리큘럼 스크롤. */
export function CurriculumTimelineCard() {
  const { view, focus, sourceProgress, years, mode, display, currentProgressPosition, setViewedPosition, syncScrolledPosition, selectionRevision, selectPeriod } = useProgressMap();
  const continuous = display === "continuous";
  const periods = useMemo(() => curriculumPeriods(view, sourceProgress), [view, sourceProgress]);
  const visible = mode === "quarter" ? periods.filter((period) => period.quarter === Math.ceil(focus.month / 3))
    : ["month", "week", "day"].includes(mode) ? periods.filter((period) => period.month === focus.month) : periods;
  const { expandedMonth, expandedYear, toggleMonth } = useExpandedMonth();
  const allYears = useMemo(() => {
    if (!continuous) return [];
    const range = timelineRange(sourceProgress);
    return years.map((year) => ({ year, periods: curriculumPeriods(buildYearView(progressForYear(sourceProgress, year)), sourceProgress)
      .filter((period) => { const position = monthPosition(year, period.month); return position >= range.min && position <= range.max; }) }))
      .filter((group) => group.periods.length > 0);
  }, [continuous, sourceProgress, years]);
  const [desktopHeight, setDesktopHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const map = document.querySelector<HTMLElement>('[data-map-design="original"]');
    if (!map) return;
    const sync = () => {
      if (window.matchMedia("(min-width: 1024px)").matches) {
        const next = Math.round(map.getBoundingClientRect().height * 100) / 100;
        setDesktopHeight(next > 0 ? next : null);
      } else {
        setDesktopHeight(null);
      }
    };
    const observer = new ResizeObserver(sync);
    observer.observe(map);
    window.addEventListener("resize", sync);
    sync();
    return () => { observer.disconnect(); window.removeEventListener("resize", sync); };
  }, []);
  const scopeKey = continuous ? `continuous:${allYears.map((group) => group.periods.map((period) => period.id).join(",")).join(",")}`
    : `card:${view.year}:${mode}:${visible.map((period) => period.month).join(",")}`;
  const { layoutRef, navigateMonth, navigatePosition, registerMonth, programmaticScroll, scrollEdges } = useTimelineScrollSpy(currentProgressPosition, setViewedPosition, scopeKey, continuous, {
    onScrollPosition: syncScrolledPosition,
    selectionRevision,
    requireUserScroll: Boolean(sourceProgress.learningMap),
    detailSelector: mode === "day" ? '[data-selected-day="true"]' : mode === "week" ? '[data-active-week="true"] button' : undefined,
  });
  const title = continuous ? "전체 진도 보기" : `${view.year}년 진도 현황`;
  return <section className={styles.timelineCard} data-learning={sourceProgress.learningMap ? "true" : undefined} style={desktopHeight ? { height: desktopHeight } : undefined} aria-label={title}>
    <header className={styles.timelineCardHeader}>
      <div><h2>{title}</h2>{sourceProgress.learningMap ? null : <p>{continuous ? "입학부터 종강까지 이어지는 학습 계획과 기록" : "오른쪽 영역만 스크롤해 월별 진도를 확인하세요."}</p>}</div>
      <span>{continuous ? "전체 기간" : VIEW_MODE_LABEL[mode as ViewMode]}</span>
    </header>
    <div className={styles.timelineCardViewport} data-scroll-above={scrollEdges?.above ? "true" : undefined} data-scroll-below={scrollEdges?.below ? "true" : undefined}>
    <div className={styles.timelineCardScroll} tabIndex={0} role="region" aria-label="진도 목록">
      <div ref={layoutRef} data-timeline-card-layout data-viewed-position={currentProgressPosition} data-programmatic-scroll={programmaticScroll ? "true" : "false"}>
        {continuous ? allYears.map((group) => <section key={group.year} className={styles.yearSection} aria-label={`${group.year}년 진도`}>
          <h3 className={styles.yearHeading}>{group.year}년 <span>{group.periods[0]!.month}~{group.periods.at(-1)!.month}월</span></h3>
          <CurriculumTimeline periods={group.periods} activeMonth={view.year === group.year ? focus.month : 0}
            expandedMonth={expandedYear === group.year ? expandedMonth : null}
            onExpand={(month) => {
              if (expandedYear === group.year && expandedMonth === month) toggleMonth(month, group.year);
              else if (view.year !== group.year || focus.month !== month) selectPeriod(group.year, month);
              else toggleMonth(month, group.year);
            }}
            onMonth={(month) => navigatePosition(monthPosition(group.year, month))}
            registerMonth={(month, element) => registerMonth(monthPosition(group.year, month), element)} />
        </section>) : <CurriculumTimeline periods={visible} activeMonth={focus.month} expandedMonth={expandedMonth}
          onExpand={month => {
            if (sourceProgress.learningMap && (focus.month !== month || mode === "year" || mode === "quarter")) selectPeriod(view.year, month);
            else toggleMonth(month);
          }}
          onMonth={navigateMonth} registerMonth={registerMonth} />}
      </div>
    </div>
    </div>
  </section>;
}
