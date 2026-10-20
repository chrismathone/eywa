"use client";

import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { formatMoney } from "@/features/billing/currencies";
import { periodQuery, type StatsPeriod } from "@/features/stats/period";
import { EXPENSE_TREND_KEYS, type ExpenseTrend } from "@/features/billing/stats/expense-trend";
import { saveExpenseStatsMode } from "@/features/billing/stats/prefs-actions";
import { chartMoney } from "../../dashboard/_overview/charts";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

const TOTAL = "var(--color-primary)";
const CATEGORY_COLORS = ["var(--color-amber)", "var(--color-green)", "var(--color-purple)", "var(--color-rose)"];

/**
 * 지출 추이 — 운영실 '이번 달 지출 내역'의 '상세'가 여기 `#expenses`로 온다. 지출일 기준(결재 상태 무관 — 카드와 같은 줄)이라
 * 이번 달 칸 = 카드의 주 통화 합계. 선 = 주 통화 합계 + 큰 분류 넷 · 다른 통화는 기간 합계로 따로(₩·$를 더하지 않는다).
 * 수치 표의 달 → 그 달 일별 · 날 → 수납관리 지출 면의 그 달.
 */
export function ExpenseTrendCard({
  trend,
  period,
  today,
  keep,
  academyWide = false,
}: {
  /** 과목 관리자 화면 — 지출은 과목으로 가르지 않아 제목에 '(학원 전체)'를 붙인다(운영실 카드와 같은 표기). */
  academyWide?: boolean;
  trend: ExpenseTrend | null;
  period: StatsPeriod;
  today: string;
  keep: Record<string, string | undefined>;
}) {
  const daily = period.grain === "day";
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const money = (n: number) => (trend ? formatMoney(n, trend.currency) : String(n));
  const series: ChartSeries[] = trend
    ? [
        { key: "_total", name: "지출", color: TOTAL, values: trend.total, strong: true },
        ...trend.categories.map((c, i) => ({ key: `c:${c.category}`, name: c.category, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!, values: c.values })),
      ]
    : [];
  const sum = trend ? trend.total.reduce((n, x) => n + x, 0) : 0;
  const count = trend ? trend.count.reduce((n, x) => n + x, 0) : 0;
  const hasOthers = !!trend?.others.length;

  return (
    <StatCard
      id="expenses"
      title={academyWide ? "지출 추이 (학원 전체)" : "지출 추이"}
      note={`지출일 기준 · 지출결의서 전건(결재 상태 무관 — 운영실 지출 카드와 같은 줄) · 선은 ${trend ? trend.currency : "주 통화"}만(통화는 섞지 않음 — 다른 통화는 표에 따로)${daily ? "" : " · 이번 달 칸은 지출일이 오늘 뒤인 결의서도 포함"}`}
      error={!trend}
      tools={
        <StatsPeriodBar
          key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`}
          period={period}
          today={today}
          keys={EXPENSE_TREND_KEYS}
          keep={keep}
          anchor="#expenses"
          onMode={(mode) => void saveExpenseStatsMode({ mode })}
        />
      }
    >
      {trend ? (
        <>
          <p className="text-sm break-keep">
            기간 합계 <b className="num">{money(sum)}</b> · {count.toLocaleString("ko-KR")}건
            {trend.others.length ? (
              <span className="text-muted-foreground">
                {" "}
                · 다른 통화 {trend.others.map((o) => `${formatMoney(o.total, o.currency)}(${o.count}건)`).join(" · ")}
              </span>
            ) : null}
          </p>
          {count === 0 ? (
            <p className="text-muted-foreground text-sm">이 기간에 지출이 없습니다.</p>
          ) : (
            <TrendChart
              labels={keys.map(axis)}
              tooltipLabels={keys.map(tip)}
              series={series}
              kind={daily ? "bar" : "line"}
              format={trend.currency === "KRW" ? chartMoney : money}
            />
          )}
          {period.grain === "day" && period.clipped ? <p className="text-muted-foreground text-xs">구간이 길어 시작일부터 31일만 보입니다.</p> : null}
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[420px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                    <th className="px-2 py-1.5 text-right font-medium">지출</th>
                    <th className="px-2 py-1.5 text-right font-medium">건수</th>
                    {hasOthers ? <th className="px-2 py-1.5 text-right font-medium">다른 통화</th> : null}
                    {trend.categories.map((c) => (
                      <th key={c.category} className="px-2 py-1.5 text-right font-medium">{c.category}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {keys
                    .map((k, i) => ({ k, i }))
                    .reverse()
                    .map(({ k, i }) => (
                      <tr key={k} className="border-line-faint border-b">
                        <td className="px-2 py-1.5 text-center">
                          <EmbedLink
                            href={daily ? `/billing?tab=expenses&period=${k.slice(0, 7)}` : `/billing/stats${periodQuery({ grain: "day", month: k }, keep, EXPENSE_TREND_KEYS)}#expenses`}
                            className="text-primary hover:underline"
                            title={daily ? "수납관리 지출 면에서 이 달 보기" : "이 달을 일별로 보기"}
                          >
                            {tip(k)}
                          </EmbedLink>
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold">{money(trend.total[i]!)}</td>
                        <td className="px-2 py-1.5 text-right">{trend.count[i]!.toLocaleString("ko-KR")}</td>
                        {hasOthers ? (
                          <td className="px-2 py-1.5 text-right">
                            {trend.othersAt[i]!.length ? trend.othersAt[i]!.map((o) => `${formatMoney(o.total, o.currency)}(${o.count}건)`).join(" · ") : "—"}
                          </td>
                        ) : null}
                        {trend.categories.map((c) => (
                          <td key={c.category} className="px-2 py-1.5 text-right">{money(c.values[i]!)}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </StatCard>
  );
}
