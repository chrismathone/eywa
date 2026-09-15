"use client";

import { memo, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { buildYearView, pctOf } from "../derive";
import { monthPosition, periodAt, rollingPeriods, timelineRange, timelineStops, turnDelta } from "../continuous-timeline";
import { VIEWBOX } from "../geometry";
import { progressForYear } from "../years";
import { CurrentPosition } from "./current-position";
import { DayRing } from "./day-ring";
import { DialLayer } from "./dial-layer";
import { ProgressMapSnapshot, useProgressMap } from "./map-state";
import { MonthRing } from "./month-ring";
import { QuarterRing } from "./quarter-ring";
import { RingLabels } from "./ring-labels";
import { HoverCtx, type HoverHandler } from "./segment";
import { WeekRing } from "./week-ring";
import { YearRing } from "./year-ring";
import styles from "./continuous-dial.module.css";

type Drag = { pointerId: number; angle: number; start: number; delta: number; moved: boolean };
const ignoreHover: HoverHandler = () => {};

export function ContinuousDial() {
  const state = useProgressMap();
  const { sourceProgress, years, view, focus, setViewedPosition } = state;
  const sliderId = useId();
  const selected = monthPosition(view.year, focus.month);
  const [origin] = useState(selected);
  const { min, max } = useMemo(() => timelineRange(sourceProgress), [sourceProgress]);
  const stops = useMemo(() => timelineStops(min, max, years), [min, max, years]);
  useEffect(() => {
    if (selected >= min && selected <= max) return;
    const target = periodAt(Math.max(min, Math.min(max, selected)));
    setViewedPosition(monthPosition(target.year, target.month));
  }, [selected, min, max, setViewedPosition]);
  const yearViews = useMemo(() => new Map(years.map((year) => [year, buildYearView(progressForYear(sourceProgress, year))])), [sourceProgress, years]);
  const positions = useMemo(() => years.flatMap((year) => Array.from({ length: 12 }, (_, i) => monthPosition(year, i + 1))).filter((position) => position >= min && position <= max), [years, min, max]);
  const months = useMemo(() => {
    const emptyYears = new Map<number, ReturnType<typeof buildYearView>>();
    return rollingPeriods(selected).map(({ year, month }) => {
      let data = yearViews.get(year) ?? emptyYears.get(year);
      if (!data) {
        data = buildYearView({ ...sourceProgress, year, yearPlan: [], dailyProgress: [] });
        emptyYears.set(year, data);
      }
      return data.months[month - 1]!;
    });
  }, [selected, sourceProgress, yearViews]);
  const clockState = useMemo(() => ({
    ...state,
    view: {
      ...view,
      months,
      quarters: view.quarters.map((q) => {
        const quarterMonths = months.filter((month) => month.quarter === q.q);
        const donePages = quarterMonths.reduce((sum, month) => sum + month.donePages, 0);
        const plannedPages = quarterMonths.reduce((sum, month) => sum + month.plannedPages, 0);
        return { ...q, months: quarterMonths, donePages, plannedPages, pct: pctOf(donePages, plannedPages) };
      }),
    },
    selectMonth: (month: number) => {
      const year = Number(months[month - 1]!.weeks[0]!.start.slice(0, 4));
      setViewedPosition(monthPosition(year, month));
    },
    selectQuarter: (quarter: 1 | 2 | 3 | 4) => {
      const month = months[(quarter - 1) * 3]!;
      const year = Number(month.weeks[0]!.start.slice(0, 4));
      if (!years.includes(year)) return;
      setViewedPosition(monthPosition(year, month.month));
      state.setMode("quarter");
    },
  }), [state, view, months, setViewedPosition, years]);
  const [preview, setPreview] = useState<number | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const position = preview ?? selected;
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const goTo = (value: number) => {
    const nearest = positions.reduce((best, candidate) => Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best, positions[0]!);
    setViewedPosition(nearest);
  };
  const angleOf = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.atan2(event.clientY - box.top - box.height / 2, event.clientX - box.left - box.width / 2) * 180 / Math.PI;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClick.current = active.moved;
    setPreview(null);
    if (!cancel && active.moved) goTo(clamp(active.start + active.delta / 30));
  };

  return (
    <div className={styles.timeline} data-continuous-period={`${view.year}-${String(focus.month).padStart(2, "0")}`}>
      <div
        className={styles.clock}
        style={{ "--clock-turn": `${(position - origin) * 30}deg` } as CSSProperties}
        data-dragging={preview !== null ? "true" : undefined}
        role="group"
        aria-label={`${sourceProgress.studentName} 연속 회전 진도맵`}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) < box.width * 145 / VIEWBOX) return;
          suppressClick.current = false;
          drag.current = { pointerId: event.pointerId, angle: angleOf(event), start: selected, delta: 0, moved: false };
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          const angle = angleOf(event);
          active.delta += turnDelta(active.angle, angle);
          active.angle = angle;
          if (Math.abs(active.delta) > 3) active.moved = true;
          if (active.moved) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setPreview(clamp(active.start + active.delta / 30));
          }
        }}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        onPointerLeave={(event) => { if (!drag.current?.moved) endDrag(event, true); }}
        onLostPointerCapture={(event) => endDrag(event, true)}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
      >
        <HoverCtx.Provider value={ignoreHover}>
          <ProgressMapSnapshot value={clockState}><ClockDrawing /></ProgressMapSnapshot>
        </HoverCtx.Provider>
      </div>
      <div className={styles.scrubber}>
        <label htmlFor={sliderId}>시간 이동</label>
        <div className={styles.rail} style={{ "--timeline-progress": `${max === min ? 0 : (selected - min) / (max - min) * 100}%` } as CSSProperties}>
          <input id={sliderId} type="range" min={min} max={max} step={1} value={selected} disabled={min === max}
            aria-label="연속 회전 월 선택" aria-valuetext={`${view.year}년 ${focus.month}월`} onChange={(event) => goTo(Number(event.target.value))} />
          <div className={styles.stops} role="group" aria-label="연도 바로가기">
            {stops.map((stop, index) => (
              <button key={stop.position} type="button" className={styles.stop}
                style={{ left: `${stop.offset}%` }} data-edge={index === 0 ? "start" : index === stops.length - 1 ? "end" : undefined}
                data-current={stop.year === view.year ? "true" : undefined}
                aria-label={`${stop.year}년 ${stop.month}월로 이동`} title={`${stop.year}년 ${stop.month}월로 이동`}
                onClick={() => goTo(stop.position)}>
                <span>{stop.year}년{periodAt(min).year === periodAt(max).year ? ` ${stop.month}월` : ""}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className={styles.hint}>왼쪽으로 감으면 과거 · 오른쪽으로 감으면 미래</p>
    </div>
  );
}

/** 기존 시계의 반지름을 그대로 쓰고 HTML 레이어만 회전한다. 가운데와 링 이름은 고정한다. */
const ClockDrawing = memo(function ClockDrawing() {
  return (
    <>
      <div className={styles.rotor} data-clock-rotor>
        <DialLayer name="quarters"><QuarterRing /></DialLayer>
        <DialLayer name="months"><YearRing showYear /></DialLayer>
        <DialLayer name="weeks"><MonthRing showYear /></DialLayer>
        <DialLayer name="days"><WeekRing /></DialLayer>
        <DialLayer name="focus"><DayRing /></DialLayer>
      </div>
      <DialLayer name="center"><CurrentPosition /></DialLayer>
      <DialLayer name="labels"><RingLabels /></DialLayer>
    </>
  );
});
