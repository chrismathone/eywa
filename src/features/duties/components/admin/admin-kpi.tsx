"use client";

/** 완성도 칸 — 과목 단계 맨 위 셋(완성도 · 기한 초과 · 원장 단계). 숫자와 막대뿐, 설명 문구 없음. */
export function Kpi({ label, value, unit, note, pct, tone }: { label: string; value: string; unit?: string; note: string; pct?: number; tone: "primary" | "green" | "danger" | "muted" }) {
  const color = tone === "danger" ? "text-danger" : tone === "green" ? "text-green" : tone === "muted" ? "text-text-dim" : "text-foreground";
  const bar = tone === "danger" ? "bg-danger" : tone === "green" ? "bg-green" : "bg-primary";
  return <div className="border-line-faint rounded-xl border px-3 py-2">
    <div className="text-text-dim text-xs font-semibold">{label}</div>
    <div className={`text-2xl font-bold leading-tight tabular-nums ${color}`}>{value}{unit ? <span className="text-text-placeholder ml-0.5 text-sm font-medium">{unit}</span> : null}</div>
    {pct != null ? <div className="bg-bg-soft mt-1 h-1.5 overflow-hidden rounded-full" aria-hidden><div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} /></div> : null}
    {note ? <div className="text-text-dim mt-0.5 truncate text-xs font-medium" title={note}>{note}</div> : null}
  </div>;
}
