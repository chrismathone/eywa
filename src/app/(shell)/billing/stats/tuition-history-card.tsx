"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveTuitionHistoryView } from "@/features/billing/stats/prefs-actions";
import { yearlyTuition, type TuitionMonth } from "@/features/billing/stats/tuition-history";
import { chartMoney } from "../../dashboard/_overview/charts";
import { StatCard } from "../../students/stats/_components/stat-card";
import { TrendChart, type ChartSeries } from "../../students/stats/_components/trend-chart";

export type TuitionView = "yearly" | "monthly";

const won = (n: number | undefined) => (n === undefined ? "—" : `${n.toLocaleString("ko-KR")}원`);
const longMonth = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;
const GENERAL = "var(--color-primary)";
/** EiE = 원생 통계 강좌수·지난 기록의 EiE 색과 같은 금색 계열. */
const EIE = "var(--gold)";

/**
 * **지난 기록 — 수업료 수납**(원장 2026-10-21 *"청구 수납도 더 이전 데이터 못찾나?"*) — 메이크에듀(2020~2025) + 에이와 청구(2026~)를 청구월마다
 * 한 선으로(`tuition-history.ts`). 위 '청구 · 수납 추이'와 **뜻이 다르다** — 여기는 수업료 수납만(교재·차량비 제외)이고 지난 기록이라
 * 오늘 바뀐 것은 다음 날 반영된다. 연도별(합) / 월별 · 연도별 표. 안내 문구는 데이터에서(EiE가 처음 실린 달 · 에이와가 이어받은 달).
 */
export function TuitionHistoryCard({ months, initialView }: { months: TuitionMonth[]; initialView: TuitionView }) {
  const [view, setView] = useState<TuitionView>(initialView);
  const years = yearlyTuition(months);
  const yearly = view === "yearly";
  const labels = yearly ? years.map((y) => y.year) : months.map((m) => `${m.month.slice(2, 4)}.${m.month.slice(5, 7)}`);
  const tips = yearly ? years.map((y) => `${y.year}년${y.months < 12 ? ` (${y.months}개월)` : ""}`) : months.map((m) => longMonth(m.month));
  const pick = (f: "general" | "eie") => (yearly ? years.map((y) => y[f] ?? null) : months.map((m) => m[f] ?? null));
  const hasEie = months.some((m) => m.eie !== undefined);
  const series: ChartSeries[] = [
    { key: "general", name: hasEie ? "EiE 외 수업료" : "수업료", color: GENERAL, values: pick("general"), strong: true },
    ...(hasEie ? [{ key: "eie", name: "EiE 수업료", color: EIE, values: pick("eie"), strong: true }] : []),
  ];
  const eieFrom = months.find((m) => (m.eie ?? 0) > 0)?.month ?? null;
  const aywaFrom = months.find((m) => m.source === "aywa")?.month ?? null;
  const first = months[0]?.month ?? null;
  const hasMakeedu = months.some((m) => m.source === "makeedu");
  const notes = [
    // 메이크에듀 기록이 있는 지점만의 사정(침산) — 에이와 청구만 쓰는 지점엔 이 이력이 없다(재리뷰 2026-10-21).
    hasMakeedu
      ? "수업료만 셉니다 — 교재·차량비 같은 다른 항목은 메이크에듀에서 2025년 5월에 청구 방식이 바뀌어 길게 견줄 수 없어 뺐습니다. 2025년 5월 전 '교재' 구분으로 청구된 수업료(EiE·국어·매쓰몽 등)는 수업료로 셉니다."
      : "수업료(수업 항목)만 셉니다 — 교재·차량비 등은 빼고 셉니다.",
    // 2026-10-28 정정: 2025-05 전 EiE 수업료도 메이크에듀 '교재' 구분에 있었다(결정 students.md) — '다른 곳에서 청구'라 적지 않는다.
    ...(eieFrom && first && eieFrom > first ? [`EiE 수업료는 ${longMonth(eieFrom)}부터 이 기록에 있습니다.`] : []),
    ...(months.some((m) => m.month === "2025-03") && months.some((m) => m.month === "2025-04")
      ? ["2025년 3~4월은 청구 방식이 바뀐 때(그 뒤로는 다음 달 수업료를 미리 청구)라 3월이 많고 4월이 적습니다 — 두 달을 합쳐 보세요."]
      : []),
    ...(aywaFrom && first && aywaFrom > first ? [`${longMonth(aywaFrom)}부터는 에이와 청구로 셉니다(그 전은 메이크에듀 수납 기록) · 에이와 쪽은 밤마다 다시 셉니다.`] : []),
  ];
  return (
    <StatCard
      id="tuition-history"
      title="지난 기록 — 수업료 수납"
      note={`${first ? `${longMonth(first)}부터` : "기록 없음"} · 청구월 기준 · 수업료(수업 항목)만 · ${yearly ? "연도별 = 그해 합" : "달마다"}`}
      tools={
        <ToolbarSegment label="보기">
          {(["yearly", "monthly"] as const).map((v) => (
            <ToolbarSegmentItem
              key={v}
              active={view === v}
              onClick={() => {
                setView(v);
                void saveTuitionHistoryView({ view: v }).catch(() => undefined);
              }}
            >
              {v === "yearly" ? "연도별" : "월별"}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      }
    >
      <TrendChart labels={labels} tooltipLabels={tips} series={series} kind={yearly ? "bar" : "line"} format={chartMoney} legend />
      <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs break-keep">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <details open={yearly}>
        <summary className="text-primary cursor-pointer text-sm font-medium select-none">연도별 표</summary>
        <div className="mt-2 overflow-x-auto px-1">
          <table className="w-full min-w-[420px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
            <thead>
              <tr className="border-line text-muted-foreground border-b text-xs">
                <th className="px-2 py-1.5 text-center font-medium">연도</th>
                <th className="px-2 py-1.5 text-right font-medium">{hasEie ? "EiE 외 수업료" : "수업료"}</th>
                {hasEie ? <th className="px-2 py-1.5 text-right font-medium">EiE 수업료</th> : null}
              </tr>
            </thead>
            <tbody className="num">
              {[...years].reverse().map((y) => (
                <tr key={y.year} className="border-line-faint border-b">
                  <td className="px-2 py-1.5 text-center whitespace-nowrap">
                    {y.year}년{y.months < 12 ? <span className="text-muted-foreground"> ({y.months}개월)</span> : null}
                  </td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap font-bold">{won(y.general)}</td>
                  {hasEie ? (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {won(y.eie)}
                      {y.eie !== undefined && y.eieMonths < y.months ? <span className="text-muted-foreground font-normal"> ({y.eieMonths}개월)</span> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </StatCard>
  );
}
