"use client";

import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { periodQuery, type StatsPeriod } from "@/features/stats/period";
import { INTAKE_TREND_KEYS, type IntakeTrend } from "@/features/enrollment/intake-trend";
import { saveIntakeTrendMode } from "@/features/enrollment/server/view-pref-actions";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const TOTAL_COLOR = "var(--color-primary)";
const UNKNOWN_COLOR = "#687787";

/**
 * 통계 보기 맨 위 **신규 문의 추이**(원장 2026-10-20 *"신규 문의 추이는 없네 신규 문의 상세에서 그것도 추가"*) — 운영실 '신규문의' ↗가 연다.
 * 월별(12·24개월) · 일별(한 달) · 구간(최대 31일). 선 = 전체 + 과목(두 과목 문의는 양쪽에) + 과목 모름. 날짜는 상담일(`intake-trend.ts`).
 * 월별 수치 표의 달을 누르면 그 달을 일별로 연다. 오늘 접수 목록(종전 ↗ 목적지)은 카드 머리 링크로 남긴다.
 */
export function IntakeTrendCard({
  trend,
  period,
  today,
  groups,
  keep,
}: {
  trend: IntakeTrend | null;
  period: StatsPeriod;
  today: string;
  /** 과목 묶음 → 이름·색(학원 설정 — 서버가 푼다). */
  groups: Record<string, { label: string; color: string }>;
  keep: Record<string, string | undefined>;
}) {
  const daily = period.grain === "day";
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const lines = trend
    ? [
        ...trend.groups.map((g) => ({ key: g.group, label: groups[g.group]?.label ?? g.group, color: groups[g.group]?.color ?? UNKNOWN_COLOR, values: g.values })),
        ...(trend.unknown.some((n) => n > 0) ? [{ key: "_unknown", label: "과목 모름", color: UNKNOWN_COLOR, values: trend.unknown }] : []),
      ]
    : [];
  const series: ChartSeries[] = trend
    ? [{ key: "_total", name: "전체", color: TOTAL_COLOR, values: trend.total, strong: true }, ...lines.map((l) => ({ key: l.key, name: l.label, color: l.color, values: l.values }))]
    : [];
  const sum = trend ? trend.total.reduce((n, x) => n + x, 0) : 0;
  const peak = trend && keys.length ? trend.total.reduce((best, v, i) => (v > trend.total[best]! ? i : best), 0) : -1;
  const unit = daily ? "하루" : "한 달";
  const rangeText = keys.length ? `${tip(keys[0]!)} ~ ${tip(keys.at(-1)!)}` : "";

  return (
    <StatCard
      id="intake"
      title="신규 문의 추이"
      note={`${rangeText}${keys.at(-1)?.startsWith(today.slice(0, 7)) ? " · 이번 달은 오늘까지" : ""} · 상담일 기준(옮겨 온 옛 상담은 시트의 상담일) · 두 과목 문의는 양쪽 선에`}
      error={!trend}
      tools={
        <>
          <StatsPeriodBar key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`} period={period} today={today} keys={INTAKE_TREND_KEYS} keep={keep} anchor="#intake" onMode={(mode) => void saveIntakeTrendMode({ mode })} />
          <EmbedLink href={`/enrollment?view=table&received=${today}`} className="text-primary text-sm font-medium whitespace-nowrap">
            오늘 접수 목록
          </EmbedLink>
        </>
      }
    >
      {trend ? (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Fact label="기간 합계" value={`${fmt(sum)}건`} />
            <Fact label={`${unit} 평균`} value={`${keys.length ? (sum / keys.length).toFixed(1) : "0"}건`} />
            <Fact label="가장 많았던 때" value={peak >= 0 && sum > 0 ? `${fmt(trend.total[peak]!)}건` : "—"} sub={peak >= 0 && sum > 0 ? tip(keys[peak]!) : undefined} />
          </dl>
          <TrendChart labels={keys.map(axis)} tooltipLabels={keys.map(tip)} series={series} kind={daily ? "bar" : "line"} unit="건" />
          {period.grain === "day" && period.clipped ? <p className="text-muted-foreground text-xs">구간이 길어 시작일부터 31일만 보입니다.</p> : null}
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[320px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                    <th className="px-2 py-1.5 text-right font-medium">전체</th>
                    {lines.map((l) => (
                      <th key={l.key} className="px-2 py-1.5 text-right font-medium">{l.label}</th>
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
                          {daily ? (
                            tip(k)
                          ) : (
                            <EmbedLink
                              href={`/enrollment${periodQuery({ grain: "day", month: k }, keep, INTAKE_TREND_KEYS)}#intake`}
                              className="text-primary hover:underline"
                              title="이 달을 일별로 보기"
                            >
                              {tip(k)}
                            </EmbedLink>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-bold">{fmt(trend.total[i]!)}</td>
                        {lines.map((l) => (
                          <td key={l.key} className="px-2 py-1.5 text-right">{fmt(l.values[i]!)}</td>
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
