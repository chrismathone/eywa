"use client";

import { createContext, useContext, type KeyboardEvent, type PointerEvent } from "react";
import type { HoverTarget } from "../tooltip-content";
import { FOCUS_FILL, FOCUS_STROKE } from "../palette";
import { SELECTION_STROKE_WIDTH } from "./svg-consts";

/**
 * 링 **칸 하나** — `<path>`에 클릭·키보드·마우스 오버를 붙인 것. 모든 링이 이 부품으로 칸을 그린다.
 *
 * 마우스 오버는 컨텍스트(`HoverCtx`)의 **안정된 콜백** 하나로 올린다 — 칸마다 핸들러를 새로 만들지 않고, 좌표 변환은
 * 지도 루트가 한다(칸은 자기 위치를 모른다). 키보드: Tab으로 옮겨 Enter/Space로 고른다.
 */
export type HoverHandler = (target: HoverTarget | null, e?: PointerEvent<SVGElement>) => void;

export const HoverCtx = createContext<HoverHandler>(() => {});

export function Segment({
  d,
  fill,
  stroke,
  strokeWidth = 0,
  dashed = false,
  selected,
  label,
  target,
  onSelect,
  focusable = true,
  className = "",
}: {
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  /** 선택한 칸은 진한 채움 + 흰 여백과 실선으로 구분한다. 글자는 링에서 FOCUS_INK를 쓴다. */
  selected?: boolean;
  /** 접근성 이름 — "9월 3주차 · 진행 중 · 59%" */
  label: string;
  target: HoverTarget;
  onSelect?: () => void;
  /** Tab 정지 여부 — 하루 눈금 ≈250개는 클릭·마우스 오버만 받고 Tab 순서에선 뺀다(같은 날은 일간 링·상세 목록에서 고른다). */
  focusable?: boolean;
  className?: string;
}) {
  const hover = useContext(HoverCtx);
  if (!d) return null;
  const onKey = (e: KeyboardEvent<SVGPathElement>) => {
    if (!onSelect) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };
  return (
    <>
      {selected ? (
        <path d={d} fill="none" stroke="var(--background)" strokeWidth={SELECTION_STROKE_WIDTH + 4} strokeLinejoin="round" className="pointer-events-none" aria-hidden />
      ) : null}
      <path
        d={d}
        fill={selected ? FOCUS_FILL : fill}
        stroke={selected ? FOCUS_STROKE : stroke ?? "none"}
        strokeWidth={selected ? SELECTION_STROKE_WIDTH : strokeWidth}
        strokeDasharray={!selected && dashed ? "6 4" : undefined}
        strokeLinejoin="round"
        role={onSelect ? "button" : undefined}
        tabIndex={onSelect ? (focusable ? 0 : -1) : undefined}
        aria-label={label}
        aria-pressed={onSelect ? selected : undefined}
        className={`outline-none transition-[fill,opacity] duration-200 motion-reduce:transition-none hover:brightness-110 focus-visible:stroke-primary focus-visible:[stroke-width:3] ${
          onSelect ? "pointer-events-auto cursor-pointer" : ""
        } ${className}`}
        onClick={onSelect}
        onKeyDown={onKey}
        onPointerEnter={(e) => hover(target, e)}
        onPointerMove={(e) => hover(target, e)}
        onPointerLeave={() => hover(null)}
      />
    </>
  );
}
