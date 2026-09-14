"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { buildYearView, type YearView } from "../derive";
import { focusOfDate, type Focus } from "../focus";
import type { PlanVsActual, StudentProgress, ViewMode } from "../model";
import { planVsActual } from "../pace";

/**
 * 진도맵 상태 — **하나의 데이터셋**(`StudentProgress`)과 그 위의 두 상태(보기 단위 · 초점)뿐이다.
 * 링·요약·상세 패널이 같은 컨텍스트를 읽어 한 곳을 누르면 셋이 함께 움직인다.
 *
 * ⚠️ 마우스 오버(툴팁)는 여기 두지 않는다 — 포인터가 움직일 때마다 컨텍스트가 바뀌면 칸 400개가 다시 그려진다.
 *    툴팁은 `progress-map.tsx`의 지역 상태다.
 */
export type ProgressMapState = {
  progress: StudentProgress;
  view: YearView;
  pace: PlanVsActual;
  mode: ViewMode;
  focus: Focus;
  setMode: (mode: ViewMode) => void;
  selectMonth: (month: number) => void;
  selectQuarter: (q: 1 | 2 | 3 | 4) => void;
  selectWeek: (month: number, week: number) => void;
  selectDay: (date: string) => void;
  resetFocus: () => void;
};

const Ctx = createContext<ProgressMapState | null>(null);

export function ProgressMapProvider({ progress, children }: { progress: StudentProgress; children: ReactNode }) {
  const view = useMemo(() => buildYearView(progress), [progress]);
  const pace = useMemo(() => planVsActual(progress), [progress]);
  const [mode, setMode] = useState<ViewMode>("month");
  const [focus, setFocus] = useState<Focus>(() => focusOfDate(progress.asOf, progress.year));

  const selectMonth = useCallback((month: number) => {
    setFocus({ month, week: null, day: null });
    setMode("month");
  }, []);
  const selectQuarter = useCallback(
    (q: 1 | 2 | 3 | 4) => {
      setFocus((f) => (Math.floor((f.month - 1) / 3) + 1 === q ? f : { month: (q - 1) * 3 + 1, week: null, day: null }));
      setMode("quarter");
    },
    [],
  );
  const selectWeek = useCallback((month: number, week: number) => {
    setFocus({ month, week, day: null });
    setMode("week");
  }, []);
  const selectDay = useCallback((date: string) => {
    setFocus(focusOfDate(date));
    setMode("day");
  }, []);
  const resetFocus = useCallback(() => setFocus(focusOfDate(progress.asOf, progress.year)), [progress.asOf, progress.year]);

  const value = useMemo<ProgressMapState>(
    () => ({ progress, view, pace, mode, focus, setMode, selectMonth, selectQuarter, selectWeek, selectDay, resetFocus }),
    [progress, view, pace, mode, focus, selectMonth, selectQuarter, selectWeek, selectDay, resetFocus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgressMap(): ProgressMapState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProgressMap은 ProgressMapProvider 안에서만 쓸 수 있습니다");
  return v;
}
