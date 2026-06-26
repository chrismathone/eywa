"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { OutcomeDistribution } from "@/features/enrollment/server/queries";

export function OutcomeDonut({ data }: { data: OutcomeDistribution }) {
  const nonZero = data.filter((d) => d.count > 0);
  const total = nonZero.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        해당 기간 데이터가 없습니다
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={nonZero}
          dataKey="count"
          nameKey="label"
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
        >
          {nonZero.map((d) => (
            <Cell key={d.outcome} fill={d.color} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => {
            const v = Number(value);
            return [`${v}건 (${Math.round((v / total) * 100)}%)`, String(name)];
          }}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            fontSize: "12px",
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span style={{ fontSize: "12px", color: "var(--color-muted-foreground)" }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
