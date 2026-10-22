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
import { buildSingleYearSeries, buildYearSeries } from "@/features/enrollment/trend-series";

/**
 * 월별 상담·등록 추이 — **막대가 기본**, 전환율 곡선은 덧그리는 옵션이다
 * (원장 2026-08-05: *"작년을 추세 곡선으로하지말고 올해 옆에 막대기로"* → *"추세곡선을 on/off"* →
 * *"기본적으로 막대그래프"* → *"3개년도도 막대그래프 가능하게"* → *"막대그래프도 on/off"*).
 *
 * 🔴 가로축은 **언제나 1월~12월**이고 연도는 막대 색으로 가른다(범례가 축 아래 색 라벨 역할).
 * 기간을 긴 타임라인으로 펴면 x축이 `1월…12월`을 반복해 어느 해인지 알 수 없었다.
 *
 * ⚠️ 전환율(%)은 **오른쪽 축**이다. 건수와 같은 축에 그리면 40~70 값이 건수 눈금(0~120)에 눌린다.
 * ⚠️ 둘 다 끄면 빈 액자가 남는다 — 그건 부모가 안내 문구로 대신한다.
 */
export function StatsTrendImpl({
  months,
  prevYearMonths,
  year,
  showBars,
  showTrendLine,
}: {
  months: MonthStat[];
  prevYearMonths: MonthStat[];
  year: number | null;
  showBars: boolean;
  showTrendLine: boolean;
}) {
  const { rows, series, rateSeries } =
    year === null ? buildYearSeries(months) : buildSingleYearSeries(months, prevYearMonths, year);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={2}>
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
          {/* 전환율 축은 곡선을 켰을 때만 — 안 그리는 축의 눈금(0~100%)만 남으면 무엇의 축인지 알 수 없다. */}
          {showTrendLine ? (
            <YAxis
              yAxisId="rate"
              orientation="right"
              domain={[0, 100]}
              unit="%"
              tick={{ fontSize: 11, fill: "var(--color-text-faint)" }}
              tickLine={false}
              axisLine={false}
            />
          ) : null}
          <Tooltip
            cursor={{ fill: "var(--color-bg-soft)", opacity: 0.5 }}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              fontSize: 12,
            }}
            formatter={(v, name) => {
              const label = String(name);
              if (v === null || v === undefined) return ["—", label];
              return [label.includes("전환율") ? `${v}%` : `${v}건`, label];
            }}
          />
          {/* 범례 = 축 아래 연도 색 라벨(원장 지시). 계열 이름에 연도를 박아 색만 보고도 짝이 지어진다.
              🔴 recharts 기본 범례는 **글자까지 계열 색으로** 칠한다 — 옛 연도 계열이 회색이라 그 라벨만
              회색 글자가 됐다(2026-09-08 "모든 회색계열은 18 18 18"). 색은 앞의 표식이 나르고 글자는 본문색으로. */}
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value) => <span style={{ color: "var(--color-foreground)" }}>{value}</span>}
          />
          {showBars
            ? series.map((s) => (
                <Bar
                  key={s.key}
                  yAxisId="cnt"
                  dataKey={s.key}
                  fill={s.color}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              ))
            : null}
          {showTrendLine
            ? rateSeries.map((s) => (
                <Line
                  key={s.key}
                  yAxisId="rate"
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  // 굵게(원장 2026-10-22 *"굵기도 조금 더"*) — 2 → 3, 점도 함께.
                  strokeWidth={3}
                  dot={{ r: 3 }}
                  connectNulls={false}
                />
              ))
            : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
