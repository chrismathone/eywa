import type { YearView } from "./derive";
import { resolveWeek, type Focus } from "./focus";
import type { ViewMode } from "./model";

export type DrillLevel = 0 | 1 | 2 | 3;

/** 현재 선택한 기간의 바로 아래 단위를 펼친다. 일간 선택은 같은 주의 날짜 안에서 유지한다. */
export function drillLevel(mode: ViewMode): DrillLevel {
  return mode === "year" ? 0 : mode === "quarter" ? 1 : mode === "month" ? 2 : 3;
}

/** 단계별 날짜 선택은 주 안에 머무르므로, 이전 링은 월이다. */
export function parentDrillMode(mode: ViewMode): ViewMode | null {
  return mode === "year" ? null : mode === "quarter" ? "year" : mode === "month" ? "quarter" : "month";
}

export function drillSceneKey(view: YearView, mode: ViewMode, focus: Focus): string {
  const level = drillLevel(mode);
  if (level === 0) return "quarters";
  if (level === 1) return `months:${Math.floor((focus.month - 1) / 3)}`;
  if (level === 2) return `weeks:${focus.month}`;
  return `days:${focus.month}:${resolveWeek(view, focus).index}`;
}
