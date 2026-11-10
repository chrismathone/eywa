"use client";

import { useState } from "react";

/** 반별 접기/펼치기 + 모두 접기/펼치기(원장 2026-11-10). 기본은 전부 펼침. */
export function useCollapse(keys: readonly string[]) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (k: string) => !closed.has(k),
    toggle: (k: string) => setClosed((cur) => { const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next; }),
    closeAll: () => setClosed(new Set(keys)),
    openAll: () => setClosed(new Set()),
    allClosed: keys.length > 0 && keys.every((k) => closed.has(k)),
  };
}

export function CollapseBar({ collapse }: { collapse: ReturnType<typeof useCollapse> }) {
  const cls = "border-line hover:bg-bg-soft h-7 rounded-md border px-2.5 text-xs font-semibold";
  return <div className="flex gap-1.5">
    <button type="button" onClick={collapse.openAll} className={cls}>모두 펼치기</button>
    <button type="button" onClick={collapse.closeAll} className={cls}>모두 접기</button>
  </div>;
}
