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

/**
 * `count` = 걸린 필터의 수 · `total` = 학원 전체(유형만 따름) — 필터가 걸렸을 때만 실린다(원장 2026-09-29
 * *"과목별과는 별도로 전체 추이수치가 필요"*). 없으면 막대 하나.
 */
export type WithdrawalMonthPoint = { label: string; count: number; total?: number };

export function WithdrawalTrendChart({
  data,
  filterLabel,
  showTotal = true,
  kind = "bar",
  unit = "명",
}: {
  data: WithdrawalMonthPoint[];
  filterLabel?: string;
  /** '학원 전체' 막대 켜기/끄기(계정 귀속 — 원장 2026-09-29). */
  showTotal?: boolean;
  kind?: "bar" | "line";
  unit?: "명" | "건";
}) {
  const withTotal = showTotal && data.some((p) => p.total !== undefined);
  // 범례는 늘 보인다(원장 2026-09-29 *"항상 이런 막대그래프에 어떤 항목인지 표시"*) — 막대 하나여도 무엇을 센 것인지 적는다.
  const countName = filterLabel ?? "퇴원";
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }} />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 14, fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          formatter={(value, name) => [`${Number(value)}${unit}`, String(name)]}
          contentStyle={{
            background: "var(--color-card)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.5rem",
            // 화면 글자 바닥 14px(디자인 v5 — 축 눈금도 같은 값. recharts는 토큰을 못 읽어 숫자로 적는다).
            fontSize: "14px",
          }}
        />
        {/* 범례 글자는 본문 색 — recharts 기본은 막대 색을 따라가 회색 막대의 '학원 전체'가 흐려졌다(원장 "대비가 너무 안좋은데"). */}
        <Legend
          wrapperStyle={{ fontSize: "14px" }}
          formatter={(value) => <span style={{ color: "var(--color-foreground)" }}>{String(value)}</span>}
        />
        {kind === "line" ? (
          <>
            {withTotal ? <Line dataKey="total" name="학원 전체" stroke="color-mix(in srgb, var(--neutral-fill) 70%, var(--card))" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} /> : null}
            <Line dataKey="count" name={countName} stroke="var(--color-rose)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          </>
        ) : (
          <>
            {withTotal ? <Bar dataKey="total" name="학원 전체" fill="color-mix(in srgb, var(--neutral-fill) 70%, var(--card))" radius={[3, 3, 0, 0]} /> : null}
            <Bar dataKey="count" name={countName} fill="var(--color-rose)" radius={[3, 3, 0, 0]} />
          </>
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
