"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthStat } from "@/features/enrollment/server/stats-queries";

/**
 * 월별 상담·등록 추이 + **전년 동월 점선**.
 * 원장 목적이 "올해와 작년 비교"라 전년선이 이 차트의 핵심이다 — 없으면 그냥 올해 막대일 뿐이다.
 *
 * ⚠️ 전환율(%)은 **오른쪽 축**이다. 건수와 같은 축에 그리면 40~70 사이 값이 건수 눈금(0~120)에
 * 눌려 변화가 안 보인다.
 */
export function StatsTrendImpl({
  months,
  prevYearMonths,
  year,
}: {
  months: MonthStat[];
  prevYearMonths: MonthStat[];
  year: number;
}) {
  const data = months.map((m, i) => ({
    label: `${Number(m.month.slice(5))}월`,
    상담: m.total,
    등록: m.enrolled,
    전환율: m.rate,
    // 전년 동월 — 그 해에 데이터가 없으면 undefined로 두어 선이 그려지지 않게(0으로 채우면 "0건이었다"는 거짓말).
    전년상담: prevYearMonths[i]?.total,
  }));
  const hasPrev = prevYearMonths.some((m) => m.total > 0);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-text-dim)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
          />
          <YAxis
            yAxisId="cnt"
            tick={{ fontSize: 11, fill: "var(--color-text-dim)" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 100]}
            unit="%"
            tick={{ fontSize: 11, fill: "var(--color-text-faint)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v, name) => {
              const label = String(name);
              if (v === null || v === undefined) return ["—", label];
              return [label === "전환율" ? `${v}%` : `${v}건`, label];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="cnt" dataKey="상담" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar yAxisId="cnt" dataKey="등록" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          {hasPrev ? (
            <Line
              yAxisId="cnt"
              type="monotone"
              dataKey="전년상담"
              name={`${year - 1}년 상담`}
              stroke="var(--color-text-faint)"
              strokeDasharray="4 4"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          ) : null}
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="전환율"
            stroke="var(--color-gold)"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
