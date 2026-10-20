"use client";

import { addDays, formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { periodQuery, type StatsPeriod } from "@/features/stats/period";
import { ratio, type ReportTrend } from "@/features/lesson-reports/stats/report-trend";
import { saveReportStatsMode } from "@/features/lesson-reports/stats/prefs-actions";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

const pct = (n: number) => `${n.toFixed(1)}%`;
const fmt = (n: number) => n.toLocaleString("ko-KR");
const READ = "var(--color-primary)";
const LOW = "var(--color-danger)";

/**
 * 학습 · 학부모 보고 추이 — 칸(수업일)마다 **숙제 60% 미만 기록 비율**(운영실 숙제 위험과 같은 판정 · 카드는 최근 7일 학생 수)과
 * **발송 후 48시간 안 학부모 확인율**(카드의 미확인과 같은 발송·매칭 조건). 표의 '지금 미확인'을 최근 30일 더하면 카드의 미확인 건수다.
 * 학부모 확인 시각은 7월부터 기록돼 그 전 칸은 발송이 없어 비어 보인다(지어내지 않는다).
 */
export function ReportTrendCard({
  trend,
  period,
  today,
  keep,
  subjectsLabel,
  classnoteOn,
}: {
  /** ClassNote 기능이 켜졌나 — 꺼지면 발송·확인 선·칸을 그리지 않는다(기능 스위치 = 흔적 없이). */
  classnoteOn: boolean;
  trend: ReportTrend | null;
  period: StatsPeriod;
  today: string;
  keep: Record<string, string | undefined>;
  /** 센 과목(보고서를 쓰는 과목 · 과목 관리자는 그 과목) — 머리 기준 문장에 적는다. */
  subjectsLabel: string;
}) {
  const daily = period.grain === "day";
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const lowRate = trend ? trend.parsed.map((p, i) => ratio(trend.low[i]!, p)) : [];
  const readRate = trend ? trend.sent.map((s, i) => ratio(trend.read48[i]!, s)) : [];
  const series: ChartSeries[] = trend
    ? [
        ...(classnoteOn ? [{ key: "read", name: "48시간 안 확인", color: READ, values: readRate, strong: true }] : []),
        { key: "low", name: "숙제 60% 미만", color: LOW, values: lowRate, strong: !classnoteOn },
      ]
    : [];
  const rows = keys.map((k, i) => ({ k, i })).filter(({ i }) => (trend?.reports[i] ?? 0) > 0);
  // 운영실 카드의 '학부모 미확인'과 같은 수 — 최근 30일(오늘 포함) 칸의 지금 미확인 합(일별 보기에서만 칸이 날짜라 셀 수 있다).
  const since = addDays(today, -29);
  const recentUnread = classnoteOn && trend && daily && period.from <= since && period.to === today ? keys.reduce((n, k, i) => (k >= since ? n + trend.unread[i]! : n), 0) : null;

  return (
    <StatCard
      id="reports"
      title="학습 · 학부모 보고 추이"
      note={`수업일 기준 · ${subjectsLabel} · 숙제 비율은 숫자로 적힌 기록만(없음·빈칸 제외)${classnoteOn ? " · 학부모 확인은 발송 성공한 보고서(카드와 같은 조건)" : ""}`}
      error={!trend}
      tools={
        <StatsPeriodBar
          key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`}
          period={period}
          today={today}
          keep={keep}
          anchor="#reports"
          onMode={(mode) => void saveReportStatsMode({ mode })}
        />
      }
    >
      {trend ? (
        rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">이 기간에 보고서가 없습니다.</p>
        ) : (
          <>
            <p className="text-sm break-keep">
              보고서 <b className="num">{fmt(trend.reports.reduce((n, x) => n + x, 0))}건</b>
              {classnoteOn ? (
                <>
                  {" "}
                  · 발송 <b className="num">{fmt(trend.sent.reduce((n, x) => n + x, 0))}건</b> · 지금 미확인(발송 48시간 경과){" "}
                  <b className="num">{fmt(trend.unread.reduce((n, x) => n + x, 0))}건</b>
                </>
              ) : null}
              {recentUnread !== null ? <span className="text-muted-foreground"> · 그중 최근 30일 {fmt(recentUnread)}건(운영실 카드 숫자)</span> : null}
            </p>
            <TrendChart labels={keys.map(axis)} tooltipLabels={keys.map(tip)} series={series} kind="line" format={pct} />
            <details>
              <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
              <div className="mt-2 overflow-x-auto px-1">
                <table className="w-full min-w-[520px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                  <thead>
                    <tr className="border-line text-muted-foreground border-b text-xs">
                      <th className="px-2 py-1.5 text-center font-medium">{daily ? "수업일" : "달"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">보고서</th>
                      <th className="px-2 py-1.5 text-right font-medium">숙제 60% 미만</th>
                      <th className="px-2 py-1.5 text-right font-medium">미제출 · 0%</th>
                      {classnoteOn ? (
                        <>
                          <th className="px-2 py-1.5 text-right font-medium">발송</th>
                          <th className="px-2 py-1.5 text-right font-medium">48시간 안 확인</th>
                          <th className="px-2 py-1.5 text-right font-medium">지금 미확인</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="num">
                    {rows
                      .slice()
                      .reverse()
                      .map(({ k, i }) => (
                        <tr key={k} className="border-line-faint border-b">
                          <td className="px-2 py-1.5 text-center">
                            {daily ? (
                              tip(k)
                            ) : (
                              <EmbedLink href={`/lesson-reports/stats${periodQuery({ grain: "day", month: k }, keep)}#reports`} className="text-primary hover:underline" title="이 달을 일별로 보기">
                                {tip(k)}
                              </EmbedLink>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-bold">{fmt(trend.reports[i]!)}</td>
                          <td className="px-2 py-1.5 text-right">
                            {lowRate[i] === null ? "—" : `${pct(lowRate[i]!)} (${fmt(trend.low[i]!)}/${fmt(trend.parsed[i]!)})`}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {fmt(trend.notSubmitted[i]!)} · {fmt(trend.zero[i]!)}
                          </td>
                          {classnoteOn ? (
                            <>
                              <td className="px-2 py-1.5 text-right">{fmt(trend.sent[i]!)}</td>
                              <td className="px-2 py-1.5 text-right">{readRate[i] === null ? "—" : pct(readRate[i]!)}</td>
                              <td className={`px-2 py-1.5 text-right ${trend.unread[i]! > 0 ? "text-danger" : ""}`}>{fmt(trend.unread[i]!)}</td>
                            </>
                          ) : null}
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
