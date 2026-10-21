"use client";

import type { ChartSeries } from "./trend-chart-impl";

/**
 * 마우스 오버 값 상자 — 머리(긴 날짜) + 합계 줄(`tooltipOnly` — 쌓은 막대의 합처럼 그리지 않는 값, 맨 위 굵게) + 선·막대마다
 * 색·이름·값(큰 순 · 값 없는 것은 뺀다).
 */
export function ValueBox({
  active,
  payload,
  series,
  showOf,
}: {
  active?: boolean;
  payload?: { dataKey?: unknown; value?: unknown; payload?: Record<string, unknown> & { tip?: string } }[];
  series: ChartSeries[];
  showOf: (s: ChartSeries) => (n: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const tip = row.tip ?? "";
  const totals = series
    .filter((s) => s.tooltipOnly)
    .map((s) => ({ s, v: typeof row[s.key] === "number" ? (row[s.key] as number) : null }))
    .filter((r): r is { s: ChartSeries; v: number } => r.v !== null);
  const rows = payload
    .map((p) => ({ s: series.find((x) => x.key === p.dataKey), v: typeof p.value === "number" ? p.value : null }))
    .filter((r): r is { s: ChartSeries; v: number } => !!r.s && !r.s.tooltipOnly && r.v !== null)
    .sort((a, b) => b.v - a.v);
  return (
    <div className="border-line bg-background rounded-lg border px-3 py-2 text-sm shadow-sm">
      <p className="text-foreground mb-1 font-bold">{tip}</p>
      <ul className="space-y-0.5">
        {totals.map(({ s, v }) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="text-foreground font-bold">{s.name}</span>
            <b className="num text-foreground ml-auto pl-3">{showOf(s)(v)}</b>
          </li>
        ))}
        {rows.map(({ s, v }) => (
          <li key={s.key} className="flex items-center gap-2">
            <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <b className="num text-foreground ml-auto pl-3">{showOf(s)(v)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 막대 보기의 범례 — 선 보기는 선 끝 이름이 범례라 막대에만 쓴다(막대가 많으면 막대 위 숫자도 없어 색만으로는 뜻을 모른다). */
export function ChartLegend({ series, note }: { series: ChartSeries[]; note?: string }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </li>
      ))}
      {note ? <li>{note}</li> : null}
    </ul>
  );
}
