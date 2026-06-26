"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ConversionTrendPoint } from "@/features/enrollment/server/queries";

export function ConversionBars({ data }: { data: ConversionTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} />
        <YAxis
          tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v) => `${v}%`}
          domain={[0, 100]}
        />
        <Tooltip
          formatter={(value, name) => [`${Number(value)}%`, String(name)]}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            fontSize: "12px",
          }}
        />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="square"
          iconSize={10}
          formatter={(value) => (
            <span style={{ fontSize: "12px", color: "var(--color-muted-foreground)" }}>{value}</span>
          )}
        />
        <Bar dataKey="consultedRate" name="상담 완료율" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="enrolledRate" name="등록 완료율" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
