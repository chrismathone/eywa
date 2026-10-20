"use client";

import { monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { paymentRateDisplay } from "@/features/billing/calc";
import type { SubjectBillingSummary } from "@/features/dashboard/overview/billing-subject";
import { saveBillingStatsMode } from "@/features/billing/stats/prefs-actions";
import { hasBilling } from "@/features/billing/stats/has-billing";
import type { StatsPeriod } from "@/features/stats/period";
import { chartMoney } from "../../dashboard/_overview/charts";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const BILLED = "var(--color-primary)";
const PAID = "var(--color-green)";

/**
 * 청구 · 수납 추이 — 달마다 **실청구 막대 하나**(운영실 '6개월 청구 · 수납' 카드와 같은 모양 · 원장 2026-09-12 *"두 개 다 있을 필요가 없다"*).
 * 수납·수납률은 마우스 오버 상자와 위 칸·표로 — 실청구와 수납은 몇십만 원 차이라 같은 축에 두 선을 그리면 한 줄로 겹치고, 이번 달만
 * 꺾여 '수납 하락'으로 읽힌다(리뷰 2026-10-21). 미수는 **지금 남은 금액**이라 추세로 그리면 늘 오른쪽 끝만 솟는다 — 위 칸(지금 미수 잔액)과
 * 표(청구월마다 남은 금액)에만 둔다. 운영실 카드와 같은 요약(`loadBillingMonths`)이라 이번 달 = 카드 값.
 * 첫 청구서가 있는 달 전은 '자료 없음'(선이 그 달부터 시작한다 — 0으로 그리면 "청구가 없었다"로 읽힌다).
 * 수치 표의 달을 누르면 수납관리의 그 달 목록으로 간다.
 */
export function BillingTrendCard({
  rows,
  next,
  period,
  today,
  scoped,
  keep,
}: {
  rows: SubjectBillingSummary[] | null;
  /** 이미 발행된 다음 달 청구(없으면 null) — 선에는 넣지 않고 한 줄로. */
  next: SubjectBillingSummary | null;
  period: StatsPeriod;
  today: string;
  /** 과목 관리자 값(청구 항목별)인가 — 과목 모름 칸을 함께 보인다. */
  scoped: boolean;
  keep: Record<string, string | undefined>;
}) {
  // 과목 관리자 값은 과목을 못 가른 청구만 있는 달도 '청구가 있는 달'이다(그 미수가 '과목 모름' 칸에 선다 — 리뷰 2026-10-20).
  const first = rows ? rows.findIndex(hasBilling) : -1;
  const valueOf = (pick: (r: SubjectBillingSummary) => number) => (rows ?? []).map((r, i) => (first >= 0 && i >= first ? pick(r) : null));
  const series: ChartSeries[] = [
    { key: "billed", name: "실청구", color: BILLED, values: valueOf((r) => r.totalBilled - r.totalDiscount), strong: true },
    { key: "paid", name: "수납", color: PAID, values: valueOf((r) => r.totalCollected), tooltipOnly: true },
    // 수납률 글자는 표·위 칸과 같은 규칙(`paymentRateDisplay` — 미수가 남았으면 100%로 적지 않는다).
    { key: "rate", name: "수납률", color: PAID, values: valueOf((r) => Number(paymentRateDisplay(r.paymentRate, r.outstanding))), tooltipOnly: true, format: (n) => `${n}%` },
  ];
  const now = rows?.at(-1);
  const unknownShown = scoped && (rows ?? []).some((r) => (r.unclassified?.billed ?? 0) > 0 || (r.unclassified?.outstanding ?? 0) > 0);

  return (
    <StatCard
      id="billing"
      title="청구 · 수납 추이"
      note={`청구월 기준 · 막대 = 실청구(청구 − 할인) · 수납·수납률은 막대에 마우스를 올리면 · 이번 달은 오늘까지 들어온 수납${scoped ? " · 담당 과목 청구 항목만(과목을 못 가른 항목은 '과목 모름')" : ""}`}
      error={!rows}
      tools={
        period.grain === "month" ? (
          <StatsPeriodBar
            key={period.months.length}
            period={period}
            today={today}
            keep={keep}
            anchor="#billing"
            modes={["month", "month24"]}
            onMode={(mode) => void saveBillingStatsMode({ mode })}
          />
        ) : null
      }
    >
      {rows ? (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Fact label={`${monthLabel(today.slice(0, 7))} 실청구`} value={now ? won(now.totalBilled - now.totalDiscount) : "—"} />
            <Fact
              label="수납"
              value={now ? won(now.totalCollected) : "—"}
              sub={now ? `수납률 ${paymentRateDisplay(now.paymentRate, now.outstanding)}%` : undefined}
            />
            <Fact label="미수 잔액" value={now ? won(now.outstanding) : "—"} sub={now ? `미납 ${now.unpaidCount}건 · 부분납 ${now.partialCount}건` : undefined} />
          </dl>
          {first < 0 ? (
            <p className="text-muted-foreground text-sm">이 기간에 청구서가 없습니다.</p>
          ) : (
            <TrendChart
              labels={rows.map((r) => `${r.period.slice(2, 4)}.${r.period.slice(5, 7)}`)}
              tooltipLabels={rows.map((r) => monthLabel(r.period))}
              series={series}
              kind="bar"
              format={chartMoney}
            />
          )}
          {next ? (
            <p className="text-sm break-keep">
              <EmbedLink href={`/billing?period=${next.period}`} className="text-primary font-medium hover:underline">
                {monthLabel(next.period)} 청구
              </EmbedLink>
              가 이미 발행됐습니다 — {next.totalCount > 0 ? `${scoped ? "담당 과목 " : ""}${next.totalCount.toLocaleString("ko-KR")}건 · 실청구 ${won(next.totalBilled - next.totalDiscount)} · 수납 ${won(next.totalCollected)}` : ""}
              {(next.unclassified?.billed ?? 0) > 0 ? `${next.totalCount > 0 ? " · " : ""}과목 모름 청구 ${won(next.unclassified!.billed)}` : ""}. 그 달이 오면 추이에 들어갑니다.
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs break-keep">
            일별 보기는 없습니다 — 수납의 결제일은 청구서마다 대표 날짜 하나라, 하루씩 나누면 여러 번에 나눠 낸 돈이 한날에 몰립니다.
          </p>
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[560px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">청구월</th>
                    <th className="px-2 py-1.5 text-right font-medium">실청구</th>
                    <th className="px-2 py-1.5 text-right font-medium">할인</th>
                    <th className="px-2 py-1.5 text-right font-medium">수납</th>
                    <th className="px-2 py-1.5 text-right font-medium">미수 잔액</th>
                    <th className="px-2 py-1.5 text-right font-medium">수납률</th>
                    <th className="px-2 py-1.5 text-right font-medium">청구서</th>
                    {unknownShown ? <th className="px-2 py-1.5 text-right font-medium">과목 모름 미수</th> : null}
                  </tr>
                </thead>
                <tbody className="num">
                  {rows
                    .map((r, i) => ({ r, i }))
                    .filter(({ i }) => first >= 0 && i >= first)
                    .reverse()
                    .map(({ r }) => (
                      <tr key={r.period} className="border-line-faint border-b">
                        <td className="px-2 py-1.5 text-center">
                          <EmbedLink href={`/billing?period=${r.period}`} className="text-primary hover:underline" title="수납관리에서 이 달 청구서 보기">
                            {monthLabel(r.period)}
                          </EmbedLink>
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold">{won(r.totalBilled - r.totalDiscount)}</td>
                        <td className="px-2 py-1.5 text-right">{won(r.totalDiscount)}</td>
                        <td className="px-2 py-1.5 text-right">{won(r.totalCollected)}</td>
                        <td className={`px-2 py-1.5 text-right ${r.outstanding > 0 ? "text-danger" : ""}`}>{won(r.outstanding)}</td>
                        <td className="px-2 py-1.5 text-right">{paymentRateDisplay(r.paymentRate, r.outstanding)}%</td>
                        <td className="px-2 py-1.5 text-right">{r.totalCount.toLocaleString("ko-KR")}건</td>
                        {unknownShown ? <td className="px-2 py-1.5 text-right">{won(r.unclassified?.outstanding ?? 0)}</td> : null}
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

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-bg-soft/40 rounded-lg px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="num text-foreground text-lg font-bold">
        {value}
        {sub ? <span className="text-muted-foreground ml-1.5 text-xs font-medium">{sub}</span> : null}
      </dd>
    </div>
  );
}
