"use client";

import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { drillLevel, drillSceneKey, parentDrillMode } from "../drilldown";
import { tooltipContent, type HoverTarget } from "../tooltip-content";
import { CurrentPosition } from "./current-position";
import { DayRing } from "./day-ring";
import { DialGuides } from "./dial-guides";
import { DialLayer } from "./dial-layer";
import { DrillNavigation } from "./drill-navigation";
import { DrilldownDial } from "./drilldown-dial";
import { useProgressMap } from "./map-state";
import { MapYearTransition } from "./map-year-transition";
import { MonthRing } from "./month-ring";
import { ProgressTooltip } from "./progress-tooltip";
import { QuarterRing } from "./quarter-ring";
import { RingLabels } from "./ring-labels";
import { HoverCtx, type HoverHandler } from "./segment";
import { WeekRing } from "./week-ring";
import { YearRing } from "./year-ring";
import mapStyles from "./progress-map.module.css";
import styles from "./year-transition.module.css";

type Hover = { scope: string; target: HoverTarget; x: number; y: number; flip: boolean; flipY: boolean; narrow: boolean };

/** 이 폭 아래(폰)에선 툴팁이 포인터를 따라가지 않고 지도 아래 가운데에 선다 — 좁은 화면에서 잘리지 않게. */
const NARROW_PX = 560;

/**
 * 원형 진도맵 — 바깥부터 분기 → 연간(달) → 월간(주) → 주간(날 눈금) → 일간(초점 주 7일) → 가운데(현재 위치).
 * SVG `path`로 그리고(CSS로 원을 겹치지 않는다), 크기는 컨테이너 폭을 따른다(viewBox).
 *
 * 툴팁 좌표는 **이 컨테이너 기준**이다 — 마우스 오버 상태는 여기 지역 상태라 링(칸 400개)은 다시 그리지 않는다
 * (링은 `memo` + 컨텍스트 읽기).
 */
export function ProgressMap({ navy = false, controls }: { navy?: boolean; controls?: ReactNode }) {
  const { view, progress, pace, mode, focus, setMode } = useProgressMap();
  const [explore, setExplore] = useState(true);
  const sceneKey = explore ? drillSceneKey(view, mode, focus) : "full";
  const hoverScope = `${view.year}:${sceneKey}:${mode}:${focus.month}:${focus.week}:${focus.day}`;
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  if (hover && hover.scope !== hoverScope) setHover(null);
  const onHover = useCallback<HoverHandler>((target, e) => {
    if (!target || !e) {
      setHover(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover({ scope: hoverScope, target, x, y, flip: x > rect.width / 2, flipY: y > rect.height / 2, narrow: rect.width < NARROW_PX });
  }, [hoverScope]);
  const goBack = () => {
    const parent = parentDrillMode(mode);
    setHover(null);
    if (parent) setMode(parent);
  };
  const content = hover ? tooltipContent(view, progress, pace, hover.target) : null;
  return (
    // 툴팁은 스크롤 상자 **밖**(이 루트)에 둔다 — `overflow-x-auto` 안에 두면 좁은 화면에서 잘리고 가로 스크롤바가 생긴다.
    <div ref={ref} className="relative w-full" onPointerLeave={() => setHover(null)}>
      <DrillNavigation controls={controls} explore={explore} onBack={goBack} onExplore={(next) => {
        if (next === explore) return;
        setExplore(next);
        setHover(null);
        if (next) setMode("year");
      }} />
      <div className="overflow-x-auto px-1 py-1">
        {/* 학생 줄·툴바·확대 경로·범례를 뺀 높이에 맞춘다. 폰에서는 360px 아래로 줄이지 않는다. */}
        <div className={`${navy ? mapStyles.dialTheme : mapStyles.original} mx-auto w-full min-w-[360px]`} style={{ maxWidth: "min(760px, calc(100dvh - 18rem))" }}
          onContextMenu={(event) => {
            if (!explore) return;
            event.preventDefault();
            goBack();
          }}>
          <HoverCtx.Provider value={onHover}>
            <MapYearTransition sceneKey={sceneKey} level={explore ? drillLevel(mode) : 0}>
              {explore ? <DrilldownDial /> : <MapDrawing />}
            </MapYearTransition>
          </HoverCtx.Provider>
        </div>
      </div>
      {explore ? <p className="mt-1 text-center text-xs text-neutral-fill">우클릭하면 이전 링으로 돌아갑니다</p> : null}
      {hover && content ? (
        <ProgressTooltip content={content} x={hover.x} y={hover.y} flip={hover.flip} flipY={hover.flipY} narrow={hover.narrow} />
      ) : null}
    </div>
  );
}

const MapDrawing = memo(function MapDrawing() {
  const { progress, view } = useProgressMap();
  return (
    <div
      className={styles.dial}
      role="group"
      aria-label={`${progress.studentName} 학습 진도맵 — ${view.year}년 ${progress.estimated ? "예상 진도" : `진도율 ${view.pct}%`}`}
    >
      <DialLayer name="guides"><DialGuides full /></DialLayer>
      <DialLayer name="quarters"><QuarterRing /></DialLayer>
      <DialLayer name="months"><YearRing /></DialLayer>
      <DialLayer name="weeks"><MonthRing /></DialLayer>
      <DialLayer name="days"><WeekRing /></DialLayer>
      <DialLayer name="focus"><DayRing /></DialLayer>
      <DialLayer name="center"><CurrentPosition /></DialLayer>
      <DialLayer name="labels"><RingLabels /></DialLayer>
      <div className={styles.sweep} aria-hidden />
    </div>
  );
});
