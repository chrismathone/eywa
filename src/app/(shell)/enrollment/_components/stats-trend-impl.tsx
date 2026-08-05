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
import { bucketTrend, pickGranularity } from "@/features/enrollment/trend-buckets";

/**
 * 월별 상담·등록 추이 + **전년 동월 점선**.
 *
 * 🔴 **전체 기간에선 막대를 그리지 않는다**(원장 2026-08-05: *"전체기간은 이렇게 상세하게 하지말고
 * 곡선하고 월별 추세정도만. 데이터 늘어나면 더 빡빡해질거같은데 말도 안됨."*). 44개월 × 막대 2개는
 * 이미 빽빽하고 해가 갈수록 무너진다 → 전체 기간은 **선 2개**(상담·전환율)만.
 * ⚠️ 전체 기간 x축은 `1월…12월` 반복이라 **어느 해인지 알 수 없었다** → 해가 바뀌는 달에만 `23년` 표시.
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
  year: number | null;
}) {
  const isAll = year === null;
  // 🔴 기간이 길어지면 눈금을 굵게 — 월 → 분기 → 연. 안 그러면 해마다 12점씩 늘어 선이 톱니가 된다.
  const gran = isAll ? pickGranularity(months.length) : "month";
  const points = bucketTrend(months, gran, isAll);
  const prevPoints = isAll ? [] : bucketTrend(prevYearMonths, gran, false);
  const data = points.map((p, i) => ({
    label: p.label,
    상담: p.total,
    등록: p.enrolled,
    전환율: p.rate,
    // 전년 동월 — 그 해에 데이터가 없으면 undefined로 두어 선이 그려지지 않게(0으로 채우면 "0건이었다"는 거짓말).
    전년상담: prevPoints[i]?.total,
  }));
  const hasPrev = prevYearMonths.some((m) => m.total > 0);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            interval={0}
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
          {/* 연도별일 때만 막대. 전체 기간은 선으로만 본다(위 주석). */}
          {isAll ? null : (
            <Bar yAxisId="cnt" dataKey="상담" fill="var(--color-primary)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          )}
          {isAll ? null : (
            <Bar yAxisId="cnt" dataKey="등록" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
          )}
          {isAll ? (
            <>
              <Line yAxisId="cnt" type="monotone" dataKey="상담" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
              <Line yAxisId="cnt" type="monotone" dataKey="등록" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
            </>
          ) : null}
          {hasPrev ? (
            <Line
              yAxisId="cnt"
              type="monotone"
              dataKey="전년상담"
              name={`${(year ?? 0) - 1}년 상담`}
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
            dot={isAll ? false : { r: 2 }}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
