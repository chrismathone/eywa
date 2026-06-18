"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GradeSeriesPoint } from "@/lib/calc/grades";

export function GradesChart({
  series,
  subjectLabels = {},
}: {
  series: GradeSeriesPoint[];
  subjectLabels?: Record<string, string>;
}) {
  if (series.length < 2) return null; // 점 1개는 추이 의미 없음
  const data = series.map((p, i) => ({ ...p, idx: i }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v) => `${v}`}
        />
        <ReferenceLine y={70} stroke="var(--color-amber)" strokeDasharray="4 4" />
        <Tooltip
          formatter={(value) => [`${Number(value)}%`, "점수"]}
          labelFormatter={(_, payload) => {
            const p = payload?.[0]?.payload as GradeSeriesPoint | undefined;
            if (!p) return "";
            return `${subjectLabels[p.subject] ?? p.subject} · ${p.label}`;
          }}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            fontSize: "12px",
          }}
        />
        <Line
          type="monotone"
          dataKey="pct"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--color-chart-2)" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
