"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type WithdrawalMonthPoint = { label: string; count: number };

export function WithdrawalTrendChart({ data }: { data: WithdrawalMonthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }} />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          formatter={(value) => [`${Number(value)}명`, "퇴원"]}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            // 화면 글자 바닥 14px(디자인 v5 — 축 눈금도 같은 값. recharts는 토큰을 못 읽어 숫자로 적는다).
            fontSize: "14px",
          }}
        />
        <Bar dataKey="count" fill="var(--color-rose)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
