"use client";

import { useState } from "react";
import { formatKoreanDate, monthLabel } from "@/lib/date-kst";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import type { PeriodKeys, PeriodMode, StatsPeriod } from "@/features/stats/period";
import { toggleSeries } from "@/features/students/stats/model";
import { StatCard } from "./stat-card";
import { SeriesChips } from "./series-chips";
import { TrendChart, type ChartSeries } from "./trend-chart";

const fmt = (n: number) => n.toLocaleString("ko-KR");

/** 그래프 하나 — 단위가 다른 값(신규생 '명' · 체크 '건')은 그래프를 나눈다. */
export type OpsChart = { title?: string; kind: "line" | "bar"; unit: string; series: ChartSeries[] };

/**
 * **매일 기록으로만 그리는 추이** 카드(원장 2026-10-20 — 지금 상태만 있는 지표 · 2026-10-21부터 쌓는다) — 콜&상담 '상담 진행 기록'과
 * '신규생 기록'이 같이 쓴다. 값은 서버가 매일 기록(`student_daily_stats.data.ops`)에서 칸으로 접어 넘긴다(`opsSeries`).
 * 기록이 없는 칸은 비운다 — 기록 시작 전을 지어내지 않는다. 일별 = 그날 23:55 상태 · 월별 = 그 달 마지막 기록일 상태.
 * `onOff`를 주면 선 고르기 칩이 선다(끈 선은 계정에 저장 — 선이 많은 카드만).
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
  charts,
  initialOff = [],
  onOff,
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
  charts: OpsChart[];
  initialOff?: string[];
  onOff?: (next: { off: string[] }) => Promise<unknown>;
  /** 보기 방식 저장(서버 액션 — 화면마다 제 칸에 저장한다). */
  onMode: (next: { mode: string }) => Promise<unknown>;
}) {
  const [off, setOff] = useState<string[]>(initialOff);
  const daily = period.grain === "day";
  const labels = period.grain === "month" ? period.months : period.days;
  const axis = (k: string) => (daily ? `${Number(k.slice(5, 7))}.${Number(k.slice(8))}` : `${k.slice(2, 4)}.${k.slice(5, 7)}`);
  const tip = (k: string) => (daily ? formatKoreanDate(k) : monthLabel(k));
  const all = charts.flatMap((c) => c.series);
  const filled = labels.map((_, i) => all.some((s) => s.values[i] !== null));
  const rows = labels.map((k, i) => ({ k, i })).filter(({ i }) => filled[i]);
  // 기록 시작 전 칸은 그리지 않는다 — 앞쪽 빈 칸을 잘라 그래프가 첫 기록부터 선다(검수 2026-10-22 원장 *"그래프가 없는데"*:
  // 24개월 보기에 점 하나가 오른쪽 끝에만 찍혀 그래프가 없는 것처럼 보였다). 점이 하나뿐이면 선을 이을 수 없어 막대로 그린다.
  const start = Math.max(0, filled.indexOf(true));
  const shown = labels.slice(start);
  const single = rows.length === 1;
  const pickable = onOff ? all.filter((s) => !s.tooltipOnly) : [];
  const pickKeys = pickable.map((s) => s.key);
  const offNow = pickKeys.some((k) => !off.includes(k)) ? off : [];
  const toggle = (key: string) => {
    const next = toggleSeries(offNow, key, pickKeys);
    setOff(next);
    void onOff?.({ off: next }).catch(() => undefined);
  };

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
          {firstDate
            ? "이 기간에는 쌓인 기록이 없습니다. 기록이 있는 기간을 골라 보세요."
            : "아직 쌓인 기록이 없습니다. 오늘 밤 23:55에 첫 기록을 남기고, 내일부터 그래프에 점이 찍힙니다(이 값은 지금 상태만 남는 숫자라 지난 날은 되살릴 수 없습니다). 오늘 값은 운영실 카드에서 볼 수 있습니다."}
        </p>
      ) : (
        <>
          {pickable.length > 1 ? <SeriesChips series={pickable.map((s) => ({ key: s.key, label: s.name, color: s.color }))} off={offNow} onToggle={toggle} /> : null}
          {single ? (
            <p className="text-muted-foreground text-xs break-keep">
              {firstDate ? `${formatKoreanDate(firstDate)}부터 기록해 ` : ""}이 기간엔 {tip(rows[0]!.k)} 한 칸뿐입니다 — 칸이 둘 이상 쌓이면 선으로 이어집니다
              {daily ? "" : " · 기간에서 '일별'이나 '구간'을 고르면 날마다 볼 수 있습니다"}
            </p>
          ) : null}
          {charts.map((c, n) => (
            <div key={c.title ?? n} className="space-y-1">
              {c.title ? <h3 className="text-foreground text-sm font-bold">{c.title}</h3> : null}
              <TrendChart
                labels={shown.map(axis)}
                tooltipLabels={shown.map(tip)}
                series={c.series.filter((s) => !offNow.includes(s.key)).map((s) => ({ ...s, values: s.values.slice(start) }))}
                kind={single ? "bar" : c.kind}
                unit={c.unit}
                legend={!onOff}
              />
            </div>
          ))}
          <details>
            <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
            <div className="mt-2 overflow-x-auto px-1">
              <table className="w-full min-w-[360px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
                <thead>
                  <tr className="border-line text-muted-foreground border-b text-xs">
                    <th className="px-2 py-1.5 text-center font-medium">{daily ? "날짜" : "달"}</th>
                    {all.map((s) => (
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
                        {all.map((s) => (
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
