"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricSeries, StatsMetric } from "@/features/consultations/stats-model";

/**
 * 지표별 색 = 의미색 캐논(design-conventions) — 상담 건수는 상담(rose), 후속 완료는 완료(green), 동기화는 정보(blue),
 * AI는 AI 라벨(gold), 미매핑은 '미상'(neutral). 두 줄 지표(녹음·AI)는 줄마다.
 * recharts는 CSS 토큰을 못 읽는 자리(글자 크기)가 있어 숫자로 적는다 — 화면 글자 바닥 14px(디자인 v5).
 */
const COLOR: Record<StatsMetric, string[]> = {
  count: ["var(--color-rose)"],
  perStudent: ["var(--color-rose)"],
  follow: ["var(--color-green)"],
  media: ["var(--color-blue)", "var(--color-gold)"],
  sync: ["var(--color-blue)"],
  class: ["var(--color-neutral-fill)"],
};

export function StatsTrendChartImpl({ series, metric }: { series: MetricSeries; metric: StatsMetric }) {
  const percent = series.unit === "%";
  const colors = COLOR[metric];
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={series.points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }} interval="preserveStartEnd" minTickGap={8} />
        <YAxis
          allowDecimals={!percent}
          domain={percent ? [0, 100] : [0, "auto"]}
          tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          formatter={(value, name) => [value === null || value === undefined ? "—" : `${Number(value)}${series.unit}`, String(name)]}
          contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "0.5rem", fontSize: "14px" }}
        />
        {/* 범례는 늘 보인다 — 막대 하나여도 무엇을 센 것인지(퇴원관리 추이와 같은 규약). 글자는 본문 색. */}
        <Legend wrapperStyle={{ fontSize: "14px" }} formatter={(v) => <span style={{ color: "var(--color-foreground)" }}>{String(v)}</span>} />
        {series.lines.map((l, i) =>
          percent ? (
            <Line
              key={l.key}
              dataKey={l.key}
              name={l.name}
              stroke={colors[i] ?? colors[0]}
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ) : (
            <Bar key={l.key} dataKey={l.key} name={l.name} fill={colors[i] ?? colors[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
