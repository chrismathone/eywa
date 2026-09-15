"use client";

import { useState } from "react";
import { useProgressMap } from "../map-state";

/** 지도의 선택이 바뀌면 해당 월을 열고, 같은 선택 안에서는 수동 접기를 유지한다. */
export function useExpandedMonth() {
  const { view, mode, focus, selectionRevision } = useProgressMap();
  const initial = mode === "year" || mode === "quarter" ? null : focus.month;
  const [expansion, setExpansion] = useState(() => ({ revision: selectionRevision, year: view.year, month: initial }));
  const current = expansion.revision === selectionRevision ? expansion : { revision: selectionRevision, year: view.year, month: initial };
  if (expansion !== current) setExpansion(current);
  return {
    expandedMonth: current.month,
    expandedYear: current.year,
    expandMonth: (month: number) => setExpansion({ revision: selectionRevision, year: view.year, month }),
    toggleMonth: (month: number, year = view.year) => setExpansion({ revision: selectionRevision, year, month: current.year === year && current.month === month ? null : month }),
  };
}
