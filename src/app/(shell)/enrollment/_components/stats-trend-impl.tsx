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

/** 글자 = 14(디자인 v5 바닥 · 다른 통계 그래프와 같은 값 — recharts는 토큰을 못 읽어 숫자로). */
const FONT = 14;

/**
 * 월별 상담·등록 추이 — **막대가 기본**, 전환율 곡선은 덧그리는 옵션이다
 * (원장 2026-08-05: *"작년을 추세 곡선으로하지말고 올해 옆에 막대기로"* → *"추세곡선을 on/off"* →
 * *"기본적으로 막대그래프"* → *"3개년도도 막대그래프 가능하게"* → *"막대그래프도 on/off"*).
 * 2026-10-22 *"여기도 막대/꺾은선으로 다른 차트 스타일과 통일"* — 막대를 끄는 대신 같은 건수를 **꺾은선**으로 그린다(`kind`).
 * 꺾은선 보기의 전환율은 **점선**이다(연도 보기는 건수 선과 전환율 선이 같은 연도 색이라 모양으로 가른다).
 *
 * 🔴 가로축은 **언제나 1월~12월**이고 연도는 막대 색으로 가른다(범례가 축 아래 색 라벨 역할).
 * 기간을 긴 타임라인으로 펴면 x축이 `1월…12월`을 반복해 어느 해인지 알 수 없었다.
 *
 * ⚠️ 전환율(%)은 **오른쪽 축**이다. 건수와 같은 축에 그리면 40~70 값이 건수 눈금(0~120)에 눌린다.
 */
export function StatsTrendImpl({
  months,
  prevYearMonths,
  year,
  kind,
  showRate,
}: {
  months: MonthStat[];
  prevYearMonths: MonthStat[];
  year: number | null;
  /** 건수의 모양 — 막대(기본) · 꺾은선. */
  kind: "bar" | "line";
  /** 전환율(%) 선을 오른쪽 축으로 겹친다. */
  showRate: boolean;
}) {
  const lineMode = kind === "line";
  const { rows, series, rateSeries } =
    year === null ? buildYearSeries(months) : buildSingleYearSeries(months, prevYearMonths, year);

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barGap={2}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            // 자리가 모자랄 때만 달을 건너뛴다(글자 14 — 좁은 창에서 12달을 다 세우면 겹친다 · 다른 통계 그래프와 같은 규칙).
            interval="preserveStartEnd"
            minTickGap={6}
            tick={{ fontSize: FONT, fill: "var(--color-text-dim)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
          />
          <YAxis
            yAxisId="cnt"
            tick={{ fontSize: FONT, fill: "var(--color-text-dim)" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          {/* 전환율 축은 곡선을 켰을 때만 — 안 그리는 축의 눈금(0~100%)만 남으면 무엇의 축인지 알 수 없다. */}
          {showRate ? (
            <YAxis
              yAxisId="rate"
              orientation="right"
              domain={[0, 100]}
              unit="%"
              tick={{ fontSize: FONT, fill: "var(--color-text-faint)" }}
              tickLine={false}
              axisLine={false}
            />
          ) : null}
          <Tooltip
            cursor={lineMode ? { stroke: "var(--color-line)", strokeWidth: 1 } : { fill: "var(--color-bg-soft)", opacity: 0.5 }}
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              fontSize: FONT,
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
            wrapperStyle={{ fontSize: FONT }}
            formatter={(value) => <span style={{ color: "var(--color-foreground)" }}>{value}</span>}
          />
          {series.map((s) =>
            lineMode ? (
              <Line
                key={s.key}
                yAxisId="cnt"
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={3}
                dot={{ r: 3 }}
                connectNulls={false}
              />
            ) : (
              <Bar key={s.key} yAxisId="cnt" dataKey={s.key} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={22} />
            ),
          )}
          {showRate
            ? rateSeries.map((s) => (
                <Line
                  key={s.key}
                  yAxisId="rate"
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  // 굵게(원장 2026-10-22 *"굵기도 조금 더"*) — 2 → 3, 점도 함께.
                  strokeWidth={3}
                  strokeDasharray={lineMode ? "6 4" : undefined}
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
