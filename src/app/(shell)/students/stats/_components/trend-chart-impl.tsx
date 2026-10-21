"use client";

import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisFloor, axisScale, endLabelOffsets, lastIndexWithValue, niceTop, stackTotals, textWidth } from "@/features/students/stats/chart-math";
import type { BasisMarker } from "@/features/students/stats/joined";
import { basisMarkerLines, ChartLegend, ValueBox } from "./trend-chart-parts";

export type ChartSeries = {
  key: string;
  name: string;
  color: string;
  values: (number | null)[];
  strong?: boolean;
  /**
   * 막대 보기에서 같은 값끼리 **쌓는다**(막대 높이 = 합). 서로 겹치지 않는 구성요소만 — 두 과목 문의처럼 한 건이 양쪽에 드는 값을
   * 쌓으면 합이 실제보다 커진다. 선 보기에서는 쓰지 않는다.
   */
  stack?: string;
  /** 그리지 않고 값 상자 맨 위에만 — 쌓은 막대의 합계처럼(합계를 구성요소 옆에 또 세우면 같은 값이 두 번 선다 · 원장 2026-10-21). */
  tooltipOnly?: boolean;
  /** 이 선만 다른 단위(신규생 '명' · 체크 '건'처럼) — 없으면 차트 단위. */
  unit?: string;
  /** 이 선만 다른 값 글자(값 상자의 수납률 '99.7%'처럼) — 없으면 차트 `format`/단위. */
  format?: (n: number) => string;
  /** 점선 — 뜻이 조금 다른 구간(지난 기록으로 메운 점 · 원장 2026-10-21 전체 추이). 막대 보기에선 색이 가른다(점선 없음). */
  dashed?: boolean;
  /** 선 끝 이름을 적지 않는다 — 다른 선에 이어 붙인 앞 구간(지난 기록)은 끝이 그래프 한가운데라 이름이 본선 위에 찍힌다(리뷰 2026-10-21). */
  endLabel?: false;
};
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
  /** 세로축 꼭대기 고정 — 비율은 100(값에 맞춘 꼭대기는 100% 위로 200%까지 올라가 정상 값이 가운데에 선다). */
  max?: number;
  /**
   * 세로축 바닥을 값에 맞춰 올린다(비율 — 90%대 선이 0~100% 축 꼭대기에 한 줄로 붙지 않게). 가장 작은 값보다 한 칸 아래의
   * 10 단위로 내린 값 · 0 아래로는 안 간다. 눈금에 바닥 값이 적혀 0부터가 아님이 보인다.
   */
  fitFloor?: boolean;
  /** 막대 보기 아래 범례 — 카드에 따로 범례(선 고르기 칩 등)가 없을 때만 켠다. */
  legend?: boolean;
  /** 구간 경계 세로선 — 기준이 바뀌는 칸(지난 기록 청구 기준 추정 → 메이크에듀 기록 → 에이와 · `basisMarkers`). */
  markers?: readonly BasisMarker[];
};

const HEIGHT = 300;
const MARGIN = { top: 16, bottom: 4, left: 4 };
const X_AXIS_H = 30;
const Y_AXIS_W = 56;
const FONT = 14; // 디자인 v5 글자 바닥 — recharts는 토큰을 못 읽는 자리라 숫자로.
const fmt = (n: number) => n.toLocaleString("ko-KR");
/**
 * recharts 본체 — 일반 차트처럼 **선 끝에 이름·값**(겹치면 위아래로 벌린다), **마우스를 올리면 그 칸의 모든 값**(큰 순),
 * 막대는 칸이 넉넉할 때(12칸 이하) 막대 위에 값(쌓은 막대는 합) + 아래 범례. 세로축은 0부터 보기 좋은 꼭대기까지(선 끝 라벨 자리 계산과
 * 같은 눈금 · `max`면 고정). 값이 null인 칸은 그리지 않는다(정확히 셀 수 없는 기간 — 선이 그 달부터 시작한다).
 */
export function TrendChartImpl({ labels, tooltipLabels, series, kind, unit = "명", format, max, fitFloor, legend, markers = [] }: TrendChartProps) {
  const showOf = (s?: ChartSeries) => s?.format ?? format ?? ((n: number) => `${fmt(n)}${s?.unit ?? unit}`);
  const lineMode = kind === "line";
  const markerSpace = markers.length * (FONT + 6) * 2;
  const plotTop = MARGIN.top + markerSpace; // 기준 문구는 데이터 위 별도 공간.
  const drawn = series.filter((s) => !s.tooltipOnly);
  const stacked = lineMode ? [] : drawn.filter((s) => s.stack);
  const totals = stackTotals(stacked, labels.length);
  // 쌓은 막대 위 합 숫자 = 보이지 않는 선의 라벨(`__total:스택`) — 막대 라벨의 순번은 높이 0인 막대를 건너뛰어 칸 번호와 어긋난다
  // (recharts 3 · 리뷰 2026-10-21 실측: 합 11인 칸에 5가 찍혔다). 선 라벨은 칸 번호 그대로라 칸마다 제 합이 선다.
  const totalKey = (stack: string) => `__total:${stack}`;
  // 축은 칸 번호(`key`) — 같은 글자('3월')가 해마다 되풀이돼도 칸이 하나로 정해진다(경계 세로선이 그 칸에 서게). 글자는 `label`.
  const keyOf = (i: number) => String(i);
  const data = labels.map((label, i) => ({
    key: keyOf(i),
    label,
    tip: tooltipLabels?.[i] ?? label,
    ...Object.fromEntries(series.map((s) => [s.key, s.values[i] ?? null])),
    ...Object.fromEntries([...totals].map(([stack, t]) => [totalKey(stack), t[i] ? t[i] : null])),
  }));
  const flat = drawn.filter((s) => lineMode || !s.stack).flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = max ?? niceTop(Math.max(0, ...flat, ...[...totals.values()].flatMap((t) => t.filter((v): v is number => v !== null))));
  const scale = axisScale(top, fitFloor && flat.length ? axisFloor(Math.min(...flat), top) : 0);
  const bottom = scale.bottom;
  // 세로축 글자 — 선마다 단위가 다르면 숫자만(단위는 선 끝·값 상자가 적는다).
  const mixed = new Set(drawn.map((s) => s.unit ?? unit)).size > 1;
  const tick = format ?? ((n: number) => (mixed ? fmt(n) : `${fmt(n)}${drawn[0]?.unit ?? unit}`));
  const ends = drawn.map((s) => {
    const i = s.endLabel === false ? -1 : lastIndexWithValue(s.values);
    return { key: s.key, index: i, value: i >= 0 ? (s.values[i] as number) : 0, text: i >= 0 ? `${s.name} ${showOf(s)(s.values[i] as number)}` : "" };
  });
  const right = lineMode ? Math.max(...ends.map((e) => textWidth(e.text)), 0) + 20 : 12;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom - X_AXIS_H;
  const offsets = endLabelOffsets(
    ends.filter((e) => e.index >= 0).map((e) => ({ key: e.key, value: e.value })),
    { top, bottom, plotTop, plotHeight },
  );
  // 쌓은 막대의 맨 위 칸(둥근 모서리 · 합 숫자 자리).
  const stackTop = new Map<string, string>();
  for (const s of stacked) stackTop.set(s.stack!, s.key);
  // 막대 위 값은 칸이 넉넉할 때(12칸 이하)만 · 쌓은 막대는 맨 위 칸에 합을 · 따로 선 막대가 셋 이상이면 이웃 값과 붙어(262270)
  // 굵은 선에만 적는다 — 나머지 값은 마우스 오버 상자가 말한다.
  const loose = drawn.filter((s) => !s.stack);
  const roomy = !lineMode && labels.length <= 12;
  const barLabelOn = (s: ChartSeries) => roomy && !s.stack && (loose.length <= 2 || !!s.strong);
  const valueText = (v: unknown) => (typeof v === "number" ? (format ? format(v) : fmt(v)) : "");
  return (
    <div className="w-full space-y-1">
      <div style={{ height: HEIGHT + markerSpace }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ ...MARGIN, top: plotTop, right }} barGap={2} barCategoryGap="22%">
            <CartesianGrid strokeDasharray="3 4" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="key"
              tickFormatter={(k: string) => labels[Number(k)] ?? ""}
              height={X_AXIS_H}
              tick={{ fontSize: FONT, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--color-border)" }}
              interval="preserveStartEnd"
              minTickGap={10}
              padding={lineMode ? { left: 14, right: 6 } : undefined}
            />
            <YAxis
              domain={[bottom, top]}
              ticks={scale.ticks}
              allowDecimals={false}
              width={Y_AXIS_W}
              tick={{ fontSize: FONT, fill: "var(--color-muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(n: number) => tick(n)}
            />
            <Tooltip
              cursor={lineMode ? { stroke: "var(--color-border)", strokeWidth: 1 } : { fill: "var(--color-bg-soft)", opacity: 0.6 }}
              content={<ValueBox series={series} showOf={showOf} />}
            />
            {drawn.map((s) => {
              const end = ends.find((e) => e.key === s.key)!;
              if (lineMode) {
                return (
                  <Line
                    key={s.key}
                    type="linear"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={s.strong ? 3 : 2.25}
                    strokeDasharray={s.dashed ? "6 5" : undefined}
                    // 점은 칸이 넉넉할 때(24칸 이하)만 — 앞뒤가 비어 혼자 선 값은 늘 찍는다(선이 없어 점이 아니면 안 보인다 · 매일 기록 첫날).
                    dot={(p: { cx?: number; cy?: number; index?: number }) => {
                      const i = p.index ?? -1;
                      const alone = s.values[i] != null && s.values[i - 1] == null && s.values[i + 1] == null;
                      if ((labels.length > 24 && !alone) || p.cx === undefined || p.cy === undefined) return <g key={`${s.key}-${i}`} />;
                      return <circle key={`${s.key}-${i}`} cx={p.cx} cy={p.cy} r={2.5} strokeWidth={1.5} stroke={s.color} fill="var(--color-background)" />;
                    }}
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
                );
              }
              const onTop = !s.stack || stackTop.get(s.stack) === s.key;
              return (
                <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={s.stack} radius={onTop ? [3, 3, 0, 0] : 0} maxBarSize={22} isAnimationActive={false}>
                  {barLabelOn(s) ? <LabelList dataKey={s.key} position="top" fontSize={FONT} fill="var(--color-foreground)" formatter={valueText} /> : null}
                </Bar>
              );
            })}
            {roomy
              ? [...totals.keys()].map((stack) => (
                  <Line key={totalKey(stack)} dataKey={totalKey(stack)} stroke="none" dot={false} activeDot={false} legendType="none" isAnimationActive={false}>
                    <LabelList dataKey={totalKey(stack)} position="top" fontSize={FONT} fill="var(--color-foreground)" formatter={valueText} />
                  </Line>
                ))
              : null}
            {basisMarkerLines(markers, keyOf, lineMode, FONT)}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {legend && !lineMode && drawn.length > 1 ? <ChartLegend series={drawn} note={stacked.length ? "막대 높이 = 합계" : undefined} /> : null}
    </div>
  );
}
