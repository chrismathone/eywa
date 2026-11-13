"use client";

import { useSyncExternalStore } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportBlock, SettledReport } from "@/features/assistant/report";
import { chartLayout } from "./chart-layout";
import {
  CHART_COLORS,
  chartPoints,
  formatAxisTick,
  formatChartValue,
  pieSlices,
  textWidth,
  type ChartPoint,
} from "./report-format";

type ChartBlock = Extract<ReportBlock, { type: "chart" }>;
type Dataset = SettledReport["datasets"][string];
export type ReportChartProps = { block: ChartBlock; dataset: Dataset };

/** 그림 높이(px) — 지연 로딩 자리(`report-chart.tsx`)와 같은 값. */
export const CHART_HEIGHT = 280;
const FONT = 14; // 디자인 v5 글자 바닥 — recharts는 토큰을 못 읽는 자리라 숫자로.
const MARGIN = { top: 18, right: 12, bottom: 4, left: 4 };
const TICK = { fontSize: FONT, fill: "var(--color-foreground)" };
const AXIS_LINE = { stroke: "var(--color-line)" };

type SeriesMeta = { key: `s${number}`; name: string; color: string };

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(cb: () => void) {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** 움직임 줄이기를 켠 사람에겐 그리는 애니메이션을 끈다. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => true);
}

const short = (s: string, max = 9) => ([...s].length > max ? `${[...s].slice(0, max - 1).join("")}…` : s);

/**
 * 학원 비서 차트 본체(recharts) — 막대·쌓은 막대·꺾은선·영역·원그래프. 숫자는 조회 결과에서 바로 읽는다(AI가 옮겨 적지 않는다).
 * 이름은 그래프 아래 범례(시리즈 2개 이상), 마우스를 올리면 그 칸의 모든 값. 세로축은 하나뿐(두 축 차트 금지).
 */
export function ReportChartImpl({ block, dataset }: ReportChartProps) {
  const reduced = useReducedMotion();
  if (block.kind === "pie") return <PieView block={block} dataset={dataset} animate={!reduced} />;

  const points = chartPoints(dataset, block.x, block.series);
  const series: SeriesMeta[] = block.series.map((s, i) => ({ key: `s${i}`, name: s.label, color: CHART_COLORS[i % CHART_COLORS.length]! }));
  const values = points.flatMap((p) => series.map((s) => p[s.key])).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return <Empty />;

  const stacked = block.kind === "stacked_bar";
  const sums = (sign: 1 | -1) =>
    points.map((p) => series.reduce((a, s) => {
      const v = p[s.key];
      return typeof v === "number" && Math.sign(v) === sign ? a + v : a;
    }, 0));
  const max = stacked ? Math.max(0, ...sums(1)) : Math.max(0, ...values);
  const min = stacked ? Math.min(0, ...sums(-1)) : Math.min(0, ...values);
  const unit = block.unit;
  const tick = (n: number) => formatAxisTick(n, unit);
  // 세로축 폭 — 가장 긴 눈금 글자에 맞춘다(보기 좋은 수로 올라간 꼭대기까지 여유 한 자).
  const yWidth = Math.min(110, Math.max(40, textWidth(tick(max * 1.1)) + 14, textWidth(tick(min * 1.1)) + 14));
  const decimals = values.some((v) => !Number.isInteger(v));
  const lineLike = block.kind === "line" || block.kind === "area";
  const layout = chartLayout(block.kind, points.map(p => p.label), series.length);
  const horizontal = layout.horizontal;
  const dots = points.length <= 24;
  // 막대 위 값 — 시리즈 하나 · 칸이 넉넉할 때(12칸 이하)만. 그 밖은 툴팁이 말한다(점마다 숫자를 세우지 않는다).
  const barLabels = !lineLike && !stacked && series.length === 1 && points.length <= 12;

  return (
    <div className="space-y-2">
      <div style={{ height: layout.height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} layout={horizontal ? "vertical" : "horizontal"} margin={horizontal ? { ...MARGIN, right: barLabels ? 52 : 16 } : MARGIN} barGap={2} barCategoryGap="24%" accessibilityLayer>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 4" vertical={horizontal} horizontal={!horizontal} />
            {horizontal ? <>
              <XAxis type="number" tick={TICK} tickLine={false} axisLine={AXIS_LINE} domain={min < 0 ? ["auto", "auto"] : [0, "auto"]} allowDecimals={decimals} tickFormatter={tick} />
              <YAxis type="category" dataKey="key" width={layout.labelWidth} interval={0} tick={TICK} tickLine={false} axisLine={false} tickFormatter={(k: string) => short(points[Number(k)]?.label ?? "", 20)} />
            </> : <>
            <XAxis
              dataKey="key"
              tickFormatter={(k: string) => short(points[Number(k)]?.label ?? "")}
              tick={TICK}
              tickLine={false}
              axisLine={AXIS_LINE}
              interval="preserveStartEnd"
              minTickGap={10}
              height={28}
              padding={lineLike ? { left: 12, right: 12 } : undefined}
            />
            <YAxis
              domain={min < 0 ? ["auto", "auto"] : [0, "auto"]}
              tickCount={5}
              allowDecimals={decimals}
              width={yWidth}
              tick={TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={(n: number) => tick(n)}
            />
            </>}
            <Tooltip
              cursor={lineLike ? { stroke: "var(--color-line-strong)", strokeWidth: 1 } : { fill: "var(--color-bg-soft)", opacity: 0.6 }}
              content={<ValueBox series={series} unit={unit} stacked={stacked} />}
              isAnimationActive={false}
            />
            {series.map((s, i) => {
              if (block.kind === "line") {
                return (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={dots ? { r: 3, strokeWidth: 2, stroke: s.color, fill: "var(--color-card)" } : false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-card)", fill: s.color }}
                    connectNulls={false}
                    isAnimationActive={!reduced}
                    animationDuration={500}
                  />
                );
              }
              if (block.kind === "area") {
                return (
                  <Area
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={2}
                    fill={s.color}
                    fillOpacity={series.length > 1 ? 0.1 : 0.16}
                    dot={false}
                    activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-card)", fill: s.color }}
                    connectNulls={false}
                    isAnimationActive={!reduced}
                    animationDuration={500}
                  />
                );
              }
              const top = !stacked || i === series.length - 1;
              return (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  fill={s.color}
                  stackId={stacked ? "stack" : undefined}
                  radius={top ? (horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
                  // 쌓은 조각 사이 2px 면 틈 — 같은 색 계열이 붙어도 경계가 보인다.
                  stroke={stacked ? "var(--color-card)" : undefined}
                  strokeWidth={stacked ? 1.5 : 0}
                  maxBarSize={36}
                  isAnimationActive={!reduced}
                  animationDuration={450}
                >
                  {barLabels ? (
                    <LabelList dataKey={s.key} position={horizontal ? "right" : "top"} fontSize={FONT} fill="var(--color-foreground)" formatter={(v: unknown) => (typeof v === "number" ? tick(v) : "")} />
                  ) : null}
                </Bar>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 ? <Legend series={series} line={lineLike} /> : null}
    </div>
  );
}

/** 마우스 오버 값 상자 — 머리(긴 날짜·항목 이름) + 시리즈 순서대로 색·이름·값(쌓은 막대는 합계 줄). */
function ValueBox({
  active,
  payload,
  series,
  unit,
  stacked,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  series: SeriesMeta[];
  unit?: string;
  stacked: boolean;
}) {
  const row = payload?.[0]?.payload as ChartPoint | undefined;
  if (!active || !row) return null;
  const rows = series.map((s) => ({ s, v: row[s.key] })).filter((r): r is { s: SeriesMeta; v: number } => typeof r.v === "number");
  if (rows.length === 0) return null;
  const total = rows.reduce((a, r) => a + r.v, 0);
  return (
    <div className="border-line bg-card max-w-72 rounded-lg border px-3 py-2 text-sm shadow-sm">
      <p className="text-foreground mb-1 font-bold break-words">{row.tip}</p>
      <ul className="space-y-0.5">
        {stacked && rows.length > 1 ? (
          <li className="flex items-center gap-2">
            <span className="font-bold">합계</span>
            <b className="num ml-auto pl-3">{formatChartValue(total, unit)}</b>
          </li>
        ) : null}
        {rows.map(({ s, v }) => (
          <li key={s.key} className="flex items-center gap-2">
            <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 truncate">{s.name}</span>
            <b className="num ml-auto pl-3 whitespace-nowrap">{formatChartValue(v, unit)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 그래프 아래 범례 — 막대는 네모, 선은 선 모양(같은 색이 어떤 표식인지 헷갈리지 않게). 글자는 글자색(시리즈 색은 표식에만). */
function Legend({ series, line }: { series: SeriesMeta[]; line: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-sm">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {line ? (
            <i aria-hidden className="inline-block h-[3px] w-4 shrink-0 rounded-full" style={{ background: s.color }} />
          ) : (
            <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
          )}
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** 원그래프 — 도넛 + 가운데 합계 + 옆 목록(조각마다 색·이름·값·비율). 첫 시리즈만 그린다. */
function PieView({ block, dataset, animate }: ReportChartProps & { animate: boolean }) {
  const column = block.series[0]!.column;
  const slices = pieSlices(dataset, block.x, column);
  if (slices.length === 0) return <Empty />;
  const total = slices.reduce((a, s) => a + s.value, 0);
  const data = slices.map((s) => ({ name: s.name, value: s.value, fill: s.color }));
  return (
    <div className="@container">
      <div className="grid items-center gap-4 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="relative w-full" style={{ height: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="58%"
                outerRadius="90%"
                paddingAngle={1}
                stroke="var(--color-card)"
                strokeWidth={2}
                isAnimationActive={animate}
                animationDuration={500}
              />
              <Tooltip content={<PieBox unit={block.unit} />} isAnimationActive={false} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-medium">합계</span>
            <span className="num text-xl font-bold">{formatChartValue(total, block.unit)}</span>
          </div>
        </div>
        <ul className="space-y-1.5 text-sm">
          {slices.map((s) => (
            <li key={s.name} className="flex items-center gap-2">
              <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate" title={s.name}>
                {s.name}
              </span>
              <span className="num whitespace-nowrap">{formatChartValue(s.value, block.unit)}</span>
              <span className="num w-14 shrink-0 text-right font-bold whitespace-nowrap">{`${(s.share * 100).toFixed(1)}%`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function PieBox({ active, payload, unit }: { active?: boolean; payload?: readonly { name?: unknown; value?: unknown; payload?: { fill?: string } }[]; unit?: string }) {
  const p = payload?.[0];
  if (!active || !p || typeof p.value !== "number") return null;
  return (
    <div className="border-line bg-card max-w-72 rounded-lg border px-3 py-2 text-sm shadow-sm">
      <p className="flex items-center gap-2">
        <i aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: p.payload?.fill }} />
        <span className="min-w-0 font-bold break-words">{String(p.name ?? "")}</span>
      </p>
      <p className="num mt-0.5">{formatChartValue(p.value, unit)}</p>
    </div>
  );
}

function Empty() {
  return (
    <div className="bg-bg-soft/40 flex items-center justify-center rounded-lg text-sm" style={{ height: CHART_HEIGHT }}>
      그릴 값이 없습니다.
    </div>
  );
}
