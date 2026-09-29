"use client";

import type { ChartKind } from "@/features/dashboard/overview/chart-prefs";
import s from "./overview.module.css";

/** 추이 패널 머리의 `막대 | 꺾은선` — 누르면 바로 바뀌고 계정에 저장된다(저장은 부모가). */
export function ChartKindToggle({ value, onChange, label }: { value: ChartKind; onChange: (k: ChartKind) => void; label: string }) {
  return (
    <div className={s.kindToggle} role="group" aria-label={`${label} 그래프 모양`}>
      {(["bar", "line"] as const).map((k) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => value !== k && onChange(k)}>
          {k === "bar" ? "막대" : "꺾은선"}
        </button>
      ))}
    </div>
  );
}
