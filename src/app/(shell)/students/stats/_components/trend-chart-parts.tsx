"use client";

import { ReferenceLine, usePlotArea } from "recharts";
import { textWidth } from "@/features/students/stats/chart-math";
import type { BasisMarker } from "@/features/students/stats/joined";
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

/**
 * 그래프 아래 범례 — 꺾은선(선 이름은 늘 여기 — 원장 2026-10-22 *"다른 화면의 꺾은선도 전부 일치화"*) · 막대(막대가 많으면 막대 위
 * 숫자도 없어 색만으로는 뜻을 모른다). 꺾은선은 표식도 선 모양(점선 계열은 점선)이라 막대 범례와 헷갈리지 않는다.
 */
export function ChartLegend({ series, note, line }: { series: ChartSeries[]; note?: string; line?: boolean }) {
  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {!line ? (
            <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
          ) : s.dashed ? (
            <i aria-hidden className="inline-block w-4 shrink-0 border-t-[3px] border-dashed" style={{ borderColor: s.color }} />
          ) : (
            <i aria-hidden className="inline-block h-[3px] w-4 shrink-0 rounded-full" style={{ background: s.color }} />
          )}
          {s.name}
        </li>
      ))}
      {note ? <li>{note}</li> : null}
    </ul>
  );
}

/**
 * 기준 경계 세로 점선 + 앞뒤 기준 이름. 경계마다 두 줄을 확보해 마지막 칸의 이름을 왼쪽에 놓아도 겹치지 않게 한다.
 * 막대는 칸 시작(막대 사이), 꺾은선은 점 위. 좁은 원생 통계 화면은 StatsWidthGate에서 막는다.
 * recharts 자식은 그 자리 요소여야 해서 컴포넌트가 아니라 요소 배열을 돌려준다.
 */
export function basisMarkerLines(markers: readonly BasisMarker[], keyOf: (i: number) => string, lineMode: boolean, font: number) {
  return markers.map((m, k) => (
    <ReferenceLine
      key={`basis-${m.index}`}
      x={keyOf(m.index)}
      position={lineMode ? "middle" : "start"}
      stroke="var(--color-muted-foreground)"
      strokeDasharray="4 4"
      ifOverflow="extendDomain"
      label={(props: { viewBox?: { x?: number; y?: number } }) => {
        const x = props.viewBox?.x;
        const y = props.viewBox?.y;
        if (x === undefined || y === undefined) return <g />;
        return <BasisLabel x={x} y={y - markers.length * (font + 6) * 2} marker={m} row={k} font={font} />;
      }}
    />
  ));
}

function BasisLabel({ x, y, marker, row, font }: { x: number; y: number; marker: BasisMarker; row: number; font: number }) {
  const plot = usePlotArea();
  if (!plot) return null;
  const before = `← ${marker.before}`;
  const after = `${marker.after} →`;
  const ty = y + font + row * (font + 6) * 2;
  const beforeX = Math.max(plot.x, x - 6 - textWidth(before));
  const afterX = Math.max(plot.x, Math.min(x + 6, plot.x + plot.width - textWidth(after)));
  const secondRow = afterX < x + 6 || (row === 0 && beforeX + textWidth(before) + 6 > afterX);
  const halo = { stroke: "var(--color-background)", strokeWidth: 4, paintOrder: "stroke" as const };
  return (
    <g fontSize={font} fill="var(--color-muted-foreground)">
      <line x1={x} x2={x} y1={ty + 6} y2={plot.y} stroke="var(--color-muted-foreground)" strokeDasharray="4 4" />
      {row === 0 ? <text x={beforeX} y={ty} {...halo}>{before}</text> : null}
      <text x={afterX} y={ty + (secondRow ? font + 6 : 0)} fontWeight={700} {...halo}>{after}</text>
    </g>
  );
}
