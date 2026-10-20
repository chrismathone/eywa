"use client";

import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import type { PeriodKeys, PeriodMode, StatsPeriod } from "@/features/stats/period";
import { StatCard } from "./stat-card";
import { TrendChart, type ChartSeries } from "./trend-chart";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/**
 * **매일 기록으로만 그리는 추이** 카드(원장 2026-10-20 — 지금 상태만 있는 지표 · 2026-10-21부터 쌓는다) — 콜&상담 '상담 진행 기록'과
 * '신규생 기록'이 같이 쓴다. 값은 서버가 매일 기록(`student_daily_stats.data.ops`)에서 칸으로 접어 넘긴다(`opsSeries`).
 * 기록이 없는 칸은 비운다 — 기록 시작 전을 지어내지 않는다. 일별 = 그날 23:55 상태 · 월별 = 그 달 마지막 기록일 상태.
 */
export function OpsHistoryCard({
  id,
  title,
  note,
  firstDate,
  period,
  today,
  keys,
  keep,
  series,
  onMode,
}: {
  id: string;
  title: string;
  note: string;
  /** 처음 기록된 날 — 없으면 아직 한 번도 안 쌓였다. */
  firstDate: string | null;
  period: StatsPeriod;
  today: string;
  keys: PeriodKeys;
  keep: Record<string, string | undefined>;
  series: { key: string; name: string; color: string; values: (number | null)[]; strong?: boolean }[];
  /** 보기 방식 저장(서버 액션 — 화면마다 제 칸에 저장한다). */
  onMode: (next: { mode: string }) => Promise<unknown>;
}) {
  const daily = period.grain === "day";
  const labels = period.grain === "month" ? period.months : period.days;
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const filled = labels.map((_, i) => series.some((s) => s.values[i] !== null));
  const rows = labels.map((k, i) => ({ k, i })).filter(({ i }) => filled[i]);
  const chart: ChartSeries[] = series.map((s) => ({ ...s }));

  return (
    <StatCard
      id={id}
      title={title}
      note={`${note} · ${firstDate ? `${formatKoreanDate(firstDate)}부터 매일 기록` : "오늘 밤(23:55)부터 매일 기록"} · ${daily ? "그날 밤 상태" : "그 달 마지막 기록일 상태"}`}
      tools={
        <StatsPeriodBar
          key={period.grain === "day" ? `${period.from}~${period.to}` : `m${period.months.length}`}
          period={period}
          today={today}
          keys={keys}
          keep={keep}
          anchor={`#${id}`}
          onMode={(mode: PeriodMode) => void onMode({ mode })}
        />
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm break-keep">
          아직 이 기간에 쌓인 기록이 없습니다. 이 값은 지금 상태만 남는 숫자라 지난 날을 되살릴 수 없어, 매일 밤 그날 상태를 기록해 쌓고 있습니다.
        </p>
      ) : (
        <>
          <TrendChart labels={labels.map(axis)} tooltipLabels={labels.map(tip)} series={chart} kind="line" unit="건" />
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[360px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                    {series.map((s) => (
                      <th key={s.key} className="px-2 py-1.5 text-right font-medium">{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="num">
                  {rows
                    .slice()
                    .reverse()
                    .map(({ k, i }) => (
                      <tr key={k} className="border-line-faint border-b">
                        <td className="px-2 py-1.5 text-center">{tip(k)}</td>
                        {series.map((s) => (
                          <td key={s.key} className="px-2 py-1.5 text-right">{s.values[i] === null ? "—" : fmt(s.values[i]!)}</td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </StatCard>
  );
}
