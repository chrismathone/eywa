"use client";

import { useMemo, type CSSProperties } from "react";
import { CX, CY, VIEWBOX, RINGS, midAngle, monthAngles, polar } from "../../geometry";
import type { CurriculumPeriod } from "../../timeline-data";
import { CurrentPosition } from "../current-position";
import { ProgressMapSnapshot, useProgressMap } from "../map-state";
import { MapDrawing } from "../progress-map";
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
  const angle = midAngle(monthAngles(activeMonth));
  const todayPoint = actual ? polar(RINGS.quarter[1] + 17, midAngle(monthAngles(actual.month))) : null;
  return <div className={`${styles.clockControl} ${mapStyles.original}`} ref={clockRef} tabIndex={0} role="group" aria-label="수학 진도 시계"
    onPointerDown={(event) => { if (event.pointerType === "mouse") clockRef.current?.focus({ preventScroll: true }); }}
    onKeyDown={(event) => {
      const delta = ["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 0;
      if (delta) { event.preventDefault(); onMonth(Math.max(1, Math.min(12, activeMonth + delta))); }
      if (event.key === "Escape" && clockRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
    }}>
    <div className={styles.clock} data-clock-month={activeMonth} data-clock-design="original">
      <ProgressMapSnapshot value={clockState}><MapDrawing center={<CurrentPosition viewed />} /></ProgressMapSnapshot>
      <div className={styles.clockIndicator} style={{ "--indicator-angle": `${angle}deg` } as CSSProperties} aria-hidden data-clock-indicator>
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
