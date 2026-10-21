"use client";

import type { MetricSeries, StatsMetric } from "@/features/consultations/stats-model";
import { TrendChart, type ChartSeries } from "../../../students/stats/_components/trend-chart";

/**
 * 지표별 색 = 의미색 캐논(design-conventions) — 상담 건수는 상담(rose), 후속 완료는 완료(green), 동기화는 정보(blue),
 * AI는 AI 라벨(gold), 반 없는 상담은 '미상'(neutral). 두 줄 지표(녹음·AI)는 줄마다.
 */
const COLOR: Record<StatsMetric, string[]> = {
  count: ["var(--color-rose)"],
  perStudent: ["var(--color-rose)"],
  follow: ["var(--color-green)"],
  media: ["var(--color-blue)", "var(--color-gold)"],
  sync: ["var(--color-blue)"],
  class: ["var(--color-neutral-fill)"],
};

/** 값 상자 머리 — 월별 `2026년 3월` · 주별 `3월 2일 주`(가로축은 짧게 `3월`·`3/2`). */
const tipOf = (b: string, unit: "month" | "week") =>
  unit === "week" ? `${Number(b.slice(5, 7))}월 ${Number(b.slice(8, 10))}일 주` : `${b.slice(0, 4)}년 ${Number(b.slice(5, 7))}월`;

/**
 * 상담 추이 — 다른 통계 화면과 **같은 공용 차트**(값 상자 · 선 끝 라벨 · 정수 눈금 · recharts 지연 로드 B5)로 그린다(Codex 협의 2026-10-21 B안 —
 * 월별·주별과 위 기간과 따로인 추이 창은 그대로). 건수는 막대, 비율은 0~100% 꺾은선.
 */
export function StatsTrendChart({ series, metric, unit }: { series: MetricSeries; metric: StatsMetric; unit: "month" | "week" }) {
  const percent = series.unit === "%";
  const colors = COLOR[metric];
  const lines: ChartSeries[] = series.lines.map((l, i) => ({
    key: l.key,
    name: l.name,
    color: colors[i] ?? colors[0]!,
    values: series.points.map((p) => {
      const v = (p as Record<string, unknown>)[l.key];
      return typeof v === "number" ? v : null;
    }),
    strong: true,
  }));
  return (
    <TrendChart
      labels={series.points.map((p) => p.label)}
      tooltipLabels={series.points.map((p) => tipOf(p.b, unit))}
      series={lines}
      kind={percent ? "line" : "bar"}
      unit={series.unit}
      {...(percent ? { max: 100 } : {})}
      legend={lines.length > 1}
    />
  );
}
