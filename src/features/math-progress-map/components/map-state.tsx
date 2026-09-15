"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { buildYearView, type YearView } from "../derive";
import { focusOfDate, type Focus } from "../focus";
import type { PlanVsActual, StudentProgress, ViewMode } from "../model";
import { planVsActual } from "../pace";
import { availableYears, progressForYear } from "../years";

/**
 * 진도맵 상태 — 학생 데이터 위의 선택 연도·보기 단위·초점. 실제 현재 위치는 연도 이동과 무관하게 유지한다.
 * 링·요약·상세 패널이 같은 컨텍스트를 읽어 한 곳을 누르면 셋이 함께 움직인다.
 *
 * ⚠️ 마우스 오버(툴팁)는 여기 두지 않는다 — 포인터가 움직일 때마다 컨텍스트가 바뀌면 칸 400개가 다시 그려진다.
 *    툴팁은 `progress-map.tsx`의 지역 상태다.
 */
export type ProgressMapState = {
  progress: StudentProgress;
  sourceProgress: StudentProgress;
  view: YearView;
  currentView: YearView;
  years: number[];
  pace: PlanVsActual;
  mode: ViewMode;
  focus: Focus;
  setMode: (mode: ViewMode) => void;
  selectYear: (year: number) => void;
  selectPeriod: (year: number, month: number) => void;
  selectMonth: (month: number) => void;
  selectQuarter: (q: 1 | 2 | 3 | 4) => void;
  selectWeek: (month: number, week: number) => void;
  selectDay: (date: string) => void;
  resetFocus: () => void;
};

const Ctx = createContext<ProgressMapState | null>(null);

/** 퇴장 중인 지도는 이전 연도의 데이터와 초점을 그대로 유지한다. */
export function ProgressMapSnapshot({ value, children }: { value: ProgressMapState; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function ProgressMapProvider({ progress: sourceProgress, children }: { progress: StudentProgress; children: ReactNode }) {
  const years = useMemo(() => availableYears(sourceProgress), [sourceProgress]);
  const [year, setYear] = useState(sourceProgress.year);
  const progress = useMemo(() => progressForYear(sourceProgress, year), [sourceProgress, year]);
  const currentView = useMemo(() => buildYearView(sourceProgress), [sourceProgress]);
  const view = useMemo(() => year === sourceProgress.year ? currentView : buildYearView(progress), [year, sourceProgress.year, currentView, progress]);
  const pace = useMemo(() => planVsActual(sourceProgress), [sourceProgress]);
  const [mode, setMode] = useState<ViewMode>("year");
  const [focus, setFocus] = useState<Focus>(() => focusOfDate(progress.asOf, progress.year));

  const selectYear = useCallback((nextYear: number) => {
    if (!years.includes(nextYear)) return;
    const target = progressForYear(sourceProgress, nextYear);
    setYear(nextYear);
    setFocus(nextYear === sourceProgress.year ? focusOfDate(sourceProgress.asOf, nextYear)
      : { month: target.yearPlan[0]?.month ?? 1, week: null, day: null });
  }, [sourceProgress, years]);
  const selectPeriod = useCallback((nextYear: number, month: number) => {
    if (!years.includes(nextYear) || month < 1 || month > 12) return;
    setYear(nextYear);
    setFocus({ month, week: 1, day: null });
    setMode("month");
  }, [years]);

  const selectMonth = useCallback((month: number) => {
    // 월을 고르면 첫 주를 실제 초점으로 둔다. 링·주간 요약·일간 내용이 같은 주를 가리켜야 한다.
    setFocus({ month, week: 1, day: null });
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
    const nextYear = Number(date.slice(0, 4));
    if (!years.includes(nextYear)) return;
    setYear(nextYear);
    setFocus(focusOfDate(date));
    setMode("day");
  }, [years]);
  const resetFocus = useCallback(() => {
    setYear(sourceProgress.year);
    setFocus(focusOfDate(sourceProgress.asOf, sourceProgress.year));
  }, [sourceProgress.asOf, sourceProgress.year]);

  const value = useMemo<ProgressMapState>(
    () => ({ progress, sourceProgress, view, currentView, years, pace, mode, focus, setMode, selectYear, selectPeriod, selectMonth, selectQuarter, selectWeek, selectDay, resetFocus }),
    [progress, sourceProgress, view, currentView, years, pace, mode, focus, selectYear, selectPeriod, selectMonth, selectQuarter, selectWeek, selectDay, resetFocus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProgressMap(): ProgressMapState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProgressMap은 ProgressMapProvider 안에서만 쓸 수 있습니다");
  return v;
}
