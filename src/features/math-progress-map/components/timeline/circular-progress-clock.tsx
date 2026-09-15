"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CX, CY, VIEWBOX, RINGS, polar } from "../../geometry";
import type { CurriculumPeriod } from "../../timeline-data";
import { CurrentPosition } from "../current-position";
import { ProgressMapSnapshot, useProgressMap } from "../map-state";
import { DayRing } from "../day-ring";
import { DialLayer } from "../dial-layer";
import { MonthRing } from "../month-ring";
import { QuarterRing } from "../quarter-ring";
import { RingLabels } from "../ring-labels";
import { WeekRing } from "../week-ring";
import { YearRing } from "../year-ring";
import mapStyles from "../progress-map.module.css";
import { useClockNavigation } from "./use-clock-navigation";
import styles from "./timeline.module.css";

/** 기존 월·주·일 동심원 시계를 타임라인의 탐색 위치에 연결한다. */
export function CircularProgressClock({ periods, activeMonth, actualDate, onMonth, onDetail }: {
  periods: CurriculumPeriod[]; activeMonth: number; actualDate: string; onMonth: (month: number) => void; onDetail: (month: number) => void;
}) {
  const state = useProgressMap();
  const clockRef = useClockNavigation(activeMonth, onMonth);
  // 월을 눌러도 연간 타임라인을 유지한다. 주·날짜 선택은 기존 상세 보기와 연결된다.
  const clockState = useMemo(() => ({ ...state, selectMonth: onMonth,
    selectWeek: (month: number, week: number, year?: number) => { state.selectWeek(month, week, year); onDetail(month); },
    selectDay: (date: string) => { state.selectDay(date); onDetail(Number(date.slice(5, 7))); },
  }), [state, onMonth, onDetail]);
  const actual = periods.find((period) => period.isActual);
  const indicatorAngle = (activeMonth - 1) * 30;
  const previousMonth = useRef(activeMonth);
  const [rotation, setRotation] = useState(0);
  useEffect(() => {
    const delta = ((activeMonth - previousMonth.current + 6) % 12) - 6;
    if (delta) setRotation((value) => value + delta * 30);
    previousMonth.current = activeMonth;
  }, [activeMonth]);
  const todayPoint = actual ? polar(RINGS.quarter[1] + 17, (actual.month - 1) * 30) : null;
  return <div className={`${styles.clockControl} ${mapStyles.original}`} ref={clockRef} tabIndex={0} role="group" aria-label="수학 진도 시계"
    onPointerDown={(event) => { if (event.pointerType === "mouse") clockRef.current?.focus({ preventScroll: true }); }}
    onKeyDown={(event) => {
      const delta = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 0;
      if (delta) { event.preventDefault(); onMonth(Math.max(1, Math.min(12, activeMonth + delta))); }
      if (event.key === "Escape" && clockRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
    }}>
    <div className={styles.clock} data-clock-month={activeMonth} data-clock-design="original">
      <ProgressMapSnapshot value={clockState}><ClockDrawing turn={rotation} /></ProgressMapSnapshot>
      <div className={styles.clockIndicator} style={{ "--indicator-angle": `${indicatorAngle}deg` } as CSSProperties} aria-hidden data-clock-indicator>
        <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}><path d={`M ${CX} ${CY - RINGS.year[0] + 2} l -9 17 h 18 Z`} /></svg>
      </div>
      {todayPoint ? <svg className={styles.clockMarkers} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
        <g className={styles.todayMarker} aria-label={`실제 오늘 ${actualDate}`}>
          <circle cx={todayPoint.x} cy={todayPoint.y} r={7} />
          <text x={todayPoint.x} y={todayPoint.y - 14} textAnchor="middle" fontSize={15} fontWeight={800}>TODAY</text>
        </g>
      </svg> : null}
    </div>
    <p className={styles.clockHint}>월을 누르거나 시계를 선택한 뒤 휠로 이동 · 주·날짜를 눌러 상세 보기</p>
  </div>;
}

/** 기존 시계의 다섯 동심원만 회전시키고 중앙 정보·링 이름은 고정한다. */
const ClockDrawing = memo(function ClockDrawing({ turn }: { turn: number }) {
  return <>
    <div className={styles.clockRotor} style={{ "--clock-turn": `${turn}deg` } as CSSProperties} data-clock-rotor>
      <DialLayer name="quarters"><QuarterRing /></DialLayer>
      <DialLayer name="months"><YearRing /></DialLayer>
      <DialLayer name="weeks"><MonthRing /></DialLayer>
      <DialLayer name="days"><WeekRing /></DialLayer>
      <DialLayer name="focus"><DayRing /></DialLayer>
    </div>
    <DialLayer name="center"><CurrentPosition viewed /></DialLayer>
    <RingLabels />
  </>;
});
