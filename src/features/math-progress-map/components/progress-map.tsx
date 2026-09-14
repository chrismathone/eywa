"use client";

import { useCallback, useRef, useState } from "react";
import { VIEWBOX } from "../geometry";
import { tooltipContent, type HoverTarget } from "../tooltip-content";
import { CurrentPosition } from "./current-position";
import { DayRing } from "./day-ring";
import { useProgressMap } from "./map-state";
import { MonthRing } from "./month-ring";
import { ProgressTooltip } from "./progress-tooltip";
import { QuarterRing } from "./quarter-ring";
import { RingLabels } from "./ring-labels";
import { HoverCtx, type HoverHandler } from "./segment";
import { WeekRing } from "./week-ring";
import { YearRing } from "./year-ring";

type Hover = { target: HoverTarget; x: number; y: number; flip: boolean; flipY: boolean; narrow: boolean };

/** 이 폭 아래(폰)에선 툴팁이 포인터를 따라가지 않고 지도 아래 가운데에 선다 — 좁은 화면에서 잘리지 않게. */
const NARROW_PX = 560;

/**
 * 원형 진도맵 — 바깥부터 분기 → 연간(달) → 월간(주) → 주간(날 눈금) → 일간(초점 주 7일) → 가운데(현재 위치).
 * SVG `path`로 그리고(CSS로 원을 겹치지 않는다), 크기는 컨테이너 폭을 따른다(viewBox).
 *
 * 툴팁 좌표는 **이 컨테이너 기준**이다 — 마우스 오버 상태는 여기 지역 상태라 링(칸 400개)은 다시 그리지 않는다
 * (링은 `memo` + 컨텍스트 읽기).
 */
export function ProgressMap() {
  const { view, progress, pace } = useProgressMap();
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const onHover = useCallback<HoverHandler>((target, e) => {
    if (!target || !e) {
      setHover(null);
      return;
    }
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setHover({ target, x, y, flip: x > rect.width / 2, flipY: y > rect.height / 2, narrow: rect.width < NARROW_PX });
  }, []);
  const content = hover ? tooltipContent(view, progress, pace, hover.target) : null;
  return (
    // 툴팁은 스크롤 상자 **밖**(이 루트)에 둔다 — `overflow-x-auto` 안에 두면 좁은 화면에서 잘리고 가로 스크롤바가 생긴다.
    <div ref={ref} className="relative w-full">
      <div className="overflow-x-auto px-1 py-1">
        {/* 지도 한 변 = 창 높이에서 학생 줄·툴바·범례 몫(≈15rem)을 뺀 값과 760px 중 작은 쪽 — 창(iframe) 첫 화면에서 원이
            통째로 보이게(mcs 창 760에선 ≈520px). 폰은 360px 아래로 안 줄인다(가로 스크롤). */}
        <div className="mx-auto w-full min-w-[360px]" style={{ maxWidth: "min(760px, calc(100dvh - 15rem))" }}>
          <HoverCtx.Provider value={onHover}>
            <svg
              viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
              className="block h-auto w-full"
              role="group"
              aria-label={`${progress.studentName} 학습 진도맵 — ${view.year}년 진도율 ${view.pct}%`}
            >
              <QuarterRing />
              <YearRing />
              <MonthRing />
              <WeekRing />
              <DayRing />
              <CurrentPosition />
              <RingLabels />
            </svg>
          </HoverCtx.Provider>
        </div>
      </div>
      {hover && content ? (
        <ProgressTooltip content={content} x={hover.x} y={hover.y} flip={hover.flip} flipY={hover.flipY} narrow={hover.narrow} />
      ) : null}
    </div>
  );
}
