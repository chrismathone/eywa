"use client";

import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { periodQuery, type StatsPeriod, MAX_DAY_SPAN } from "@/features/stats/period";
import type { RateTrend } from "@/features/attendance/stats/rate-trend";
import { saveAttendanceStatsMode } from "@/features/attendance/stats/prefs-actions";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

const pct = (n: number) => `${n.toFixed(1)}%`;
const TOTAL = "var(--color-primary)";

/**
 * 등원율 추이 — 칸마다 (출석 + 지각) ÷ 기록 칸(운영실 '최근 14일 등원율'과 같은 판정 → 오늘 칸 = 카드의 오늘 점).
 * 선 = 전체 + 과목 묶음(반 과목). 기록이 없는 칸(휴일 · 에이와 출결을 쓰기 전)은 비운다. 칸마다 기록 칸 수를 표에 함께 적어
 * 표본이 작은 칸(주말 몇 칸)을 읽는 사람이 가려 보게 한다. 수치 표의 달 → 그 달 일별 · 날 → 출석부의 그날.
 */
export function RateTrendCard({
  trend,
  period,
  today,
  groups,
  keep,
  scoped,
}: {
  trend: RateTrend | null;
  period: StatsPeriod;
  today: string;
  groups: Record<string, { label: string; color: string }>;
  keep: Record<string, string | undefined>;
  scoped: boolean;
}) {
  const daily = period.grain === "day";
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const lines = (trend?.groups ?? []).map((g) => ({ key: g.group, label: groups[g.group]?.label ?? g.group, color: groups[g.group]?.color ?? "var(--neutral-fill)", rate: g.rate }));
  const series: ChartSeries[] = trend
    ? [{ key: "_total", name: "전체", color: TOTAL, values: trend.rate, strong: true }, ...lines.map((l) => ({ key: l.key, name: l.label, color: l.color, values: l.rate }))]
    : [];
  const rows = keys.map((k, i) => ({ k, i })).filter(({ i }) => (trend?.total[i] ?? 0) > 0);
  const cells = trend ? trend.total.reduce((n, x) => n + x, 0) : 0;

  return (
    <StatCard
      id="rate"
      title="등원율 추이"
      note={`(출석 + 지각) ÷ 유효 출결 칸(운영실 등원율과 같은 판정 · 보강·조퇴·공결은 출석이 아님) · 같은 칸을 고쳐 찍었으면 마지막 기록${scoped ? " · 담당 과목 반만(반 과목을 모르면 포함)" : ""} · 세로축은 값에 맞춰 바닥을 올렸습니다`}
      error={!trend}
      tools={
        <StatsPeriodBar
          key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`}
          period={period}
          today={today}
          keep={keep}
          anchor="#rate"
          onMode={(mode) => void saveAttendanceStatsMode({ mode })}
        />
      }
    >
      {trend ? (
        rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">이 기간에 찍힌 출결 기록이 없습니다.</p>
        ) : (
          <>
            <p className="text-sm">
              유효 출결 칸 <b className="num">{cells.toLocaleString("ko-KR")}칸</b> · 출결 기록이 없는 칸(휴일이거나 에이와 출결을 쓰기 전)은 비워 둡니다
            </p>
            <TrendChart labels={keys.map(axis)} tooltipLabels={keys.map(tip)} series={series} kind="line" format={pct} max={100} fitFloor />
            {period.grain === "day" && period.clipped ? <p className="text-muted-foreground text-xs">구간이 길어 시작일부터 두 달({MAX_DAY_SPAN}일)만 보입니다.</p> : null}
            <details>
              <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
              <div className="mt-2 overflow-x-auto px-1">
                <table className="w-full min-w-[360px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                  <thead>
                    <tr className="border-line text-muted-foreground border-b text-xs">
                      <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">등원율</th>
                      <th className="px-2 py-1.5 text-right font-medium">유효 출결 칸</th>
                      {lines.map((l) => (
                        <th key={l.key} className="px-2 py-1.5 text-right font-medium">{l.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="num">
                    {rows
                      .slice()
                      .reverse()
                      .map(({ k, i }) => (
                        <tr key={k} className="border-line-faint border-b">
                          <td className="px-2 py-1.5 text-center">
                            <EmbedLink
                              href={daily ? `/attendance/${k}` : `/attendance/stats${periodQuery({ grain: "day", month: k }, keep)}#rate`}
                              className="text-primary hover:underline"
                              title={daily ? "출석부에서 그날 보기" : "이 달을 일별로 보기"}
                            >
                              {tip(k)}
                            </EmbedLink>
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold">{trend.rate[i] === null ? "—" : pct(trend.rate[i]!)}</td>
                          <td className="px-2 py-1.5 text-right">{trend.total[i]!.toLocaleString("ko-KR")}</td>
                          {lines.map((l) => (
                            <td key={l.key} className="px-2 py-1.5 text-right">{l.rate[i] === null ? "—" : pct(l.rate[i]!)}</td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )
      ) : null}
    </StatCard>
  );
}
