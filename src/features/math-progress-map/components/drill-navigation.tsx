"use client";

import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { drillLevel } from "../drilldown";
import { resolveWeek } from "../focus";
import { useProgressMap } from "./map-state";

export type MapDisplay = "drill" | "full" | "continuous";

export function DrillNavigation({ display, onDisplay, onBack, controls }: { display: MapDisplay; onDisplay: (value: MapDisplay) => void; onBack: () => void; controls?: ReactNode }) {
  const explore = display === "drill";
  const { mode, setMode, view, focus, selectQuarter, selectMonth } = useProgressMap();
  const level = drillLevel(mode);
  const quarter = (Math.floor((focus.month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const week = resolveWeek(view, focus);
  const crumbs = [
    { label: `${view.year}년`, onClick: () => setMode("year") },
    { label: `${quarter}분기`, onClick: () => selectQuarter(quarter) },
    { label: `${focus.month}월`, onClick: () => selectMonth(focus.month) },
    { label: `${week.index}주`, onClick: () => setMode("week") },
  ];
  const parentCrumb = crumbs[level - 1];
  return (
    <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-2">
      <div className="flex flex-[1_1_20rem] flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {explore ? <nav aria-label="진도 확대 경로" className="flex items-center gap-1 text-xs">
          {parentCrumb ? <button type="button" onClick={onBack} className="text-primary rounded-md p-1 hover:bg-primary-soft" aria-label="한 단계 위로"><EyIcon name="chevronLeft" size={16} /></button> : null}
          <ol className="flex flex-wrap items-center gap-1">
            {crumbs.slice(0, level + 1).map((crumb, index) => (
              <li key={index} className="flex items-center gap-1">
                {index > 0 ? <EyIcon name="chevronRight" size={12} className="text-text-dim" /> : null}
                <button type="button" onClick={crumb.onClick} aria-current={index === level ? "step" : undefined}
                  className={`rounded-md px-1.5 py-1 font-bold ${index === level ? "bg-primary-soft text-primary" : "text-text-dim hover:text-primary"}`}>
                  {crumb.label}
                </button>
              </li>
            ))}
          </ol>
        </nav> : null}
        <ToolbarSegment title="지도 표시 방식">
          <ToolbarSegmentItem active={explore} onClick={() => onDisplay("drill")}>단계별 확대</ToolbarSegmentItem>
          <ToolbarSegmentItem active={display === "full"} onClick={() => onDisplay("full")}>전체 지도</ToolbarSegmentItem>
          <ToolbarSegmentItem active={display === "continuous"} onClick={() => onDisplay("continuous")}>연속 회전</ToolbarSegmentItem>
        </ToolbarSegment>
      </div>
      {controls}
    </div>
  );
}
