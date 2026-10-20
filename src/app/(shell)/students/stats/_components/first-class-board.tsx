"use client";

import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { EmbedLink } from "@/components/embed-link";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { periodQuery, type StatsPeriod } from "@/features/stats/period";
import { FIRST_CLASS_KEYS, type FirstClassTrend } from "@/features/students/stats/first-class-trend";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { studentsFirstClassHref } from "@/features/dashboard/overview/kpi-links";
import { StatCard } from "./stat-card";
import { TrendChart, type ChartSeries } from "./trend-chart";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const FIRST = "var(--color-primary)";
const NEW_SUBJECT = "var(--color-green)";

/**
 * 첫 수업 추이(원장 2026-10-20 *"오늘 첫수업도 마찬가지"*) — 운영실 '오늘첫수업' ↗가 연다. 날마다 같은 판정(첫 등원 + 새 과목)을 돌린 수.
 * 월별 칸 = 그 달 날마다 센 수의 합 · 수치 표의 달을 누르면 그 달 일별 · 날을 누르면 원생목록의 그날 첫 수업 학생.
 * 에이와 수강 기록이 갖춰지기 전 달은 그리지 않는다(옮겨 온 학생의 시작일이 옮긴 날로 잡혀 솟는다).
 */
export function FirstClassBoard({
  trend,
  period,
  today,
  keep,
  scopeLabel,
}: {
  trend: FirstClassTrend | null;
  period: StatsPeriod;
  today: string;
  keep: Record<string, string | undefined>;
  scopeLabel: string | null;
}) {
  const daily = period.grain === "day";
  const keys = trend?.keys ?? [];
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const total = trend ? trend.first.map((v, i) => (v === null ? null : v + (trend.newSubject[i] ?? 0))) : [];
  const series: ChartSeries[] = trend
    ? [
        { key: "total", name: "첫 수업", color: FIRST, values: total, strong: true },
        { key: "first", name: "첫 등원", color: "#687787", values: trend.first },
        { key: "newSubject", name: "새 과목", color: NEW_SUBJECT, values: trend.newSubject },
      ]
    : [];
  const shown = total.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
  const sum = shown.reduce((n, x) => n + x.v, 0);
  const clipped = trend ? total.some((v) => v === null) && shown.length > 0 : false;

  return (
    <StatCard
      id="first"
      title="첫 수업 추이"
      note={`첫 등원 + 이미 다니던 학생의 새 과목 첫 수업(운영실 '오늘첫수업'과 같은 판정) · 반 추가·반이동은 세지 않음${daily ? "" : " · 달 = 날마다 센 수의 합"}${scopeLabel ? ` · ${scopeLabel} 첫 수업만` : ""}`}
      error={!trend}
      tools={
        <>
          <StatsPeriodBar
            key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`}
            period={period}
            today={today}
            keys={FIRST_CLASS_KEYS}
            keep={keep}
            anchor="#first"
            onMode={(mode) => void saveStudentStatsPrefs({ firstMode: mode })}
          />
          {/* 원생목록 첫 수업 명단은 과목으로 좁히지 못한다 — 과목 관리자 화면엔 세우지 않는다(표 숫자와 명단이 갈린다 · 리뷰 2026-10-20). */}
          {scopeLabel ? null : (
            <EmbedLink href={studentsFirstClassHref(today)} className="text-primary text-sm font-medium whitespace-nowrap">
              오늘 첫 수업 학생
            </EmbedLink>
          )}
        </>
      }
    >
      {trend ? (
        shown.length === 0 ? (
          <p className="text-muted-foreground text-sm break-keep">이 기간은 에이와 수강 기록이 갖춰지기 전이라 첫 수업을 셀 수 없습니다.</p>
        ) : (
          <>
            <p className="text-sm">
              기간 합계 <b className="num">{fmt(sum)}명</b>
              {clipped ? <span className="text-muted-foreground"> · 에이와 수강 기록이 갖춰진 달부터 셉니다</span> : null}
            </p>
            <TrendChart labels={keys.map(axis)} tooltipLabels={keys.map(tip)} series={series} kind={daily ? "bar" : "line"} unit="명" />
            <details>
              <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
              <div className="mt-2 overflow-x-auto px-1">
                <table className="w-full min-w-[320px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                  <thead>
                    <tr className="border-line text-muted-foreground border-b text-xs">
                      <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                      <th className="px-2 py-1.5 text-right font-medium">첫 수업</th>
                      <th className="px-2 py-1.5 text-right font-medium">첫 등원</th>
                      <th className="px-2 py-1.5 text-right font-medium">새 과목</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {shown
                      .slice()
                      .reverse()
                      .map(({ v, i }) => {
                        const k = keys[i]!;
                        return (
                          <tr key={k} className="border-line-faint border-b">
                            <td className="px-2 py-1.5 text-center">
                              {daily && scopeLabel ? (
                                tip(k)
                              ) : (
                              <EmbedLink
                                href={daily ? studentsFirstClassHref(k) : `/students/stats${periodQuery({ grain: "day", month: k }, keep, FIRST_CLASS_KEYS)}#first`}
                                className="text-primary hover:underline"
                                title={daily ? "원생목록에서 그날 첫 수업 학생 보기" : "이 달을 일별로 보기"}
                              >
                                {tip(k)}
                              </EmbedLink>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right font-bold">{fmt(v)}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(trend.first[i] ?? 0)}</td>
                            <td className="px-2 py-1.5 text-right">{fmt(trend.newSubject[i] ?? 0)}</td>
                          </tr>
                        );
                      })}
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
