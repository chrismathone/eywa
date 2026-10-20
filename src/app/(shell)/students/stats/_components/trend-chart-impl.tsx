"use client";

import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisTicks, endLabelOffsets, lastIndexWithValue, niceTop, textWidth } from "@/features/students/stats/chart-math";

export type ChartSeries = { key: string; name: string; color: string; values: (number | null)[]; strong?: boolean };
export type TrendChartProps = {
  /** 가로축 라벨(짧게 — `26.03`). */
  labels: string[];
  /** 값 상자 머리(길게 — `2026년 3월`). 없으면 가로축 라벨. */
  tooltipLabels?: string[];
  series: ChartSeries[];
  kind: "line" | "bar";
  unit?: string;
  /** 값 글자(눈금·선 끝·막대 위·값 상자) — 없으면 `1,234명`. 돈은 `1,234만`처럼 줄여 쓴다(수납 통계). */
  format?: (n: number) => string;
};

const HEIGHT = 300;
const MARGIN = { top: 16, bottom: 4, left: 4 };
const X_AXIS_H = 30;
const FONT = 14; // 디자인 v5 글자 바닥 — recharts는 토큰을 못 읽는 자리라 숫자로.
const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * recharts 본체 — 일반 차트처럼 **선 끝에 이름·값**(겹치면 위아래로 벌린다), **마우스를 올리면 그 칸의 모든 값**(큰 순),
 * 막대는 칸이 넉넉할 때(12칸 이하) 막대 위에 값. 세로축은 0부터 보기 좋은 꼭대기까지(선 끝 라벨 자리 계산과 같은 눈금).
 * 값이 null인 칸은 그리지 않는다(정확히 셀 수 없는 기간 — 선이 그 달부터 시작한다).
 */
export function TrendChartImpl({ labels, tooltipLabels, series, kind, unit = "명", format }: TrendChartProps) {
  const show = format ?? ((n: number) => `${fmt(n)}${unit}`);
  const data = labels.map((label, i) => ({
    label,
    tip: tooltipLabels?.[i] ?? label,
    ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? null])),
  }));
  const top = niceTop(Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const ends = series.map((s) => {
    const i = lastIndexWithValue(s.values);
    return { key: s.key, index: i, value: i >= 0 ? (s.values[i] as number) : 0, text: i >= 0 ? `${s.name} ${show(s.values[i] as number)}` : "" };
  });
  const lineMode = kind === "line";
  const right = lineMode ? Math.max(...ends.map((e) => textWidth(e.text)), 0) + 20 : 12;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_H;
  const offsets = endLabelOffsets(
    ends.filter((e) => e.index >= 0).map((e) => ({ key: e.key, value: e.value })),
    { top, plotTop: MARGIN.top, plotHeight },
  );
  // 막대 위 값은 칸이 넉넉할 때(12칸 이하)만 · 선이 셋 이상이면 이웃 막대 값과 붙어(262270) 학원 전체(굵은 선)에만 적는다 —
  // 나머지 값은 마우스 오버 상자가 말한다.
  const barLabelOn = (s: ChartSeries) => !lineMode && labels.length <= 12 && (series.length <= 2 || !!s.strong);

  return (
    <div style={{ height: HEIGHT }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ ...MARGIN, right }} barGap={2} barCategoryGap="22%">
          <CartesianGrid strokeDasharray="3 4" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            height={X_AXIS_H}
            tick={{ fontSize: FONT, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-border)" }}
            interval="preserveStartEnd"
            minTickGap={10}
            padding={lineMode ? { left: 14, right: 6 } : undefined}
          />
          <YAxis
            domain={[0, top]}
            ticks={axisTicks(top)}
            allowDecimals={false}
            width={56}
            tick={{ fontSize: FONT, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(n: number) => show(n)}
          />
          <Tooltip
            cursor={lineMode ? { stroke: "var(--color-border)", strokeWidth: 1 } : { fill: "var(--color-bg-soft)", opacity: 0.6 }}
            content={<ValueBox series={series} show={show} />}
          />
          {series.map((s) => {
            const end = ends.find((e) => e.key === s.key)!;
            return lineMode ? (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={s.strong ? 3 : 2.25}
                dot={labels.length <= 24 ? { r: 2.5, strokeWidth: 1.5, fill: "var(--color-background)" } : false}
                activeDot={{ r: 5, strokeWidth: 0, fill: s.color }}
                connectNulls={false}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey={s.key}
                  content={(props) => {
                    const { x, y, index } = props as { x?: number; y?: number; index?: number };
                    if (index !== end.index || x === undefined || y === undefined) return null;
                    return (
                      <text x={Number(x) + 9} y={Number(y) + (offsets.get(s.key) ?? 0)} dominantBaseline="middle" fontSize={FONT} fontWeight={700} fill={s.color}>
                        {end.text}
                      </text>
                    );
                  }}
                />
              </Line>
            ) : (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                {barLabelOn(s) ? (
                  <LabelList dataKey={s.key} position="top" fontSize={FONT} fill="var(--color-foreground)" formatter={(v: unknown) => (typeof v === "number" ? (format ? format(v) : fmt(v)) : "")} />
                ) : null}
              </Bar>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 마우스 오버 값 상자 — 머리(긴 날짜) + 선마다 색·이름·값(큰 순 · 값 없는 선은 뺀다). */
function ValueBox({ active, payload, series, show }: { active?: boolean; payload?: { dataKey?: unknown; value?: unknown; payload?: { tip?: string } }[]; series: ChartSeries[]; show: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  const tip = payload[0]?.payload?.tip ?? "";
  const rows = payload
    .map((p) => ({ s: series.find((x) => x.key === p.dataKey), v: typeof p.value === "number" ? p.value : null }))
    .filter((r): r is { s: ChartSeries; v: number } => !!r.s && r.v !== null)
    .sort((a, b) => b.v - a.v);
  return (
    <div className="border-line bg-background rounded-lg border px-3 py-2 text-sm shadow-sm">
      <p className="text-foreground mb-1 font-bold">{tip}</p>
      <ul className="space-y-0.5">
        {rows.map(({ s, v }) => (
          <li key={s.key} className="flex items-center gap-2">
            <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="text-muted-foreground">{s.name}</span>
            <b className="num text-foreground ml-auto pl-3">{show(v)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
