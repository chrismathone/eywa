"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { maskBefore } from "@/features/students/stats/chart-math";
import {
  TOTAL_TOKEN,
  TREND_RANGES,
  TREND_RANGE_LABELS,
  axisLabel,
  longLabel,
  pointsFor,
  toggleSeries,
  tokenColor,
  type ChartKind,
  type SeriesSet,
  type StudentStatsPrefs,
  type TrendRange,
  type TrendView,
} from "@/features/students/stats/model";
import { StatCard } from "./stat-card";
import { SeriesChips } from "./series-chips";
import { TrendChart } from "./trend-chart";
import { TrendFacts } from "./trend-facts";
import { TrendTable } from "./trend-table";

/** 과목 한 줄 · 수강 구성 한 줄 — `key`는 선 키(`subject:math` · `mix:both`). */
export type TrendLine = { key: string; label: string; color: string; set: SeriesSet };

const VIEW_LABELS: Record<TrendView, string> = { subject: "과목별", mix: "수강 구성" };
const NOTES: Record<TrendView, string> = {
  subject: "과목별 = 그날 그 과목 반 수강이 걸려 있던 재원생 · 두 과목을 들으면 양쪽에 들어 합이 학원 전체보다 클 수 있습니다.",
  mix: "수강 구성 = 그날 걸려 있던 수강의 과목 묶음(영어만 · 영어+수학 · 수학만 · 그 밖의 과목만).",
};
const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;

/**
 * 재원생 추이(자세히) — 운영실 '재원생 추이'와 같은 판정을 셀 수 있는 달부터 · 주별 · 연도별로, **첫 선(학원 전체 · 과목 관리자는
 * 담당 과목 전체)과 과목별(또는 수강 구성별) 선을 한 그래프에 색깔별로**(원장 2026-10-20). 선 끝에 이름·값, 마우스를 올리면 그 칸의 값.
 * 🔴 과목·구성 선은 **수강 종료가 처음 기록된 달부터**(`breakdownFrom`) — 그 전에 그만둔 학생은 수강 기록이 없어 과목을 가를 수 없다.
 *    첫 선의 아래 경계(`countFrom`)는 화면(page.tsx)이 정한다. 내내 0인 선은 칩도 세우지 않는다.
 * 범위·보기·선 켜고 끄기·그래프 종류는 클라에서 바꾼다(원본을 한 번에 받아 두었다) · 바꾼 값은 계정에 저장(넘긴 칸만).
 */
export function TrendBoard({
  total,
  subjects,
  mixes,
  countFrom,
  breakdownFrom,
  clipNote,
  today,
  scopeLabel,
  initial,
}: {
  total: SeriesSet;
  subjects: TrendLine[];
  mixes: TrendLine[];
  /** 첫 선의 아래 경계(YYYY-MM) — 그 전은 정확히 셀 수 없어 그리지 않는다. */
  countFrom: string | null;
  breakdownFrom: string | null;
  /** 아래 경계를 알리는 문장(화면이 이유와 함께 만든다). */
  clipNote: string | null;
  today: string;
  /** 과목 관리자의 담당 과목(예: '영어') — 있으면 첫 선이 '영어 전체'이고 수강 구성 보기는 없다. */
  scopeLabel: string | null;
  initial: Pick<StudentStatsPrefs, "range" | "view" | "off"> & { kind: ChartKind };
}) {
  const [range, setRange] = useState<TrendRange>(initial.range);
  const [chosenView, setView] = useState<TrendView>(initial.view);
  const [off, setOff] = useState<string[]>(initial.off);
  const [kind, setKind] = useState<ChartKind>(initial.kind);
  const save = (patch: Partial<StudentStatsPrefs>) => void saveStudentStatsPrefs(patch).catch(() => undefined);
  // 수강 구성 선이 없으면(과목 관리자) 과목별만.
  const view: TrendView = mixes.length ? chosenView : "subject";
  const totalLabel = scopeLabel ? `${scopeLabel} 전체` : "학원 전체";

  const totalPoints = pointsFor(total, range, countFrom);
  const lines = [
    { key: "total", label: totalLabel, color: tokenColor(TOTAL_TOKEN), values: totalPoints.map((p) => p.count as number | null), strong: true },
    ...(view === "subject" ? subjects : mixes).map((l) => ({
      key: l.key,
      label: l.label,
      color: l.color,
      values: maskBefore(pointsFor(l.set, range, countFrom), breakdownFrom),
      strong: false,
    })),
  ].filter((l) => l.key === "total" || l.values.some((v) => v !== null && v > 0));
  const keys = lines.map((l) => l.key);
  // 켜 둔 선이 이 범위에 하나도 없으면(내내 0인 선만 켜 두었다) 전부 켠 것으로 본다 — 칩 표시도 같은 값(리뷰 2026-10-20: 칩은 다 꺼졌는데 선은 다 그려졌다).
  const offNow = keys.some((k) => !off.includes(k)) ? off : [];
  const shown = lines.filter((l) => !offNow.includes(l.key));
  const clipped = !!breakdownFrom && totalPoints.some((p) => p.date.slice(0, 7) < breakdownFrom) && lines.length > 1;

  const toggle = (key: string) => {
    const next = toggleSeries(offNow, key, keys);
    setOff(next);
    save({ off: next });
  };

  return (
    <StatCard
      id="trend"
      title="재원생 추이"
      note={`${range === "w26" ? "주마다 일요일" : range === "y" ? "해마다 연말" : "달마다 말일"} 기준(마지막 칸은 오늘) · 휴원 제외 · 운영실 '재원생' 카드와 같은 판정`}
      tools={
        <>
          <ToolbarSegment label="기간">
            {TREND_RANGES.map((r) => (
              <ToolbarSegmentItem key={r} active={range === r} onClick={() => { setRange(r); save({ range: r }); }}>
                {TREND_RANGE_LABELS[r]}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
          {mixes.length ? (
            <ToolbarSegment label="나눠 보기">
              {(["subject", "mix"] as const).map((v) => (
                <ToolbarSegmentItem key={v} active={view === v} onClick={() => { setView(v); save({ view: v }); }}>
                  {VIEW_LABELS[v]}
                </ToolbarSegmentItem>
              ))}
            </ToolbarSegment>
          ) : null}
          <ToolbarSegment label="그래프">
            {(["line", "bar"] as const).map((k) => (
              <ToolbarSegmentItem key={k} active={kind === k} onClick={() => { setKind(k); save({ trendKind: k }); }}>
                {k === "line" ? "꺾은선" : "막대"}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        </>
      }
    >
      <SeriesChips series={lines.map((l) => ({ key: l.key, label: l.label, color: l.color }))} off={offNow} onToggle={toggle} />
      <TrendChart
        kind={kind}
        labels={totalPoints.map((p) => axisLabel(p, range))}
        tooltipLabels={totalPoints.map((p) => longLabel(p, range, today))}
        series={shown.map((l) => ({ key: l.key, name: l.label, color: l.color, values: l.values, strong: l.strong }))}
      />
      <TrendFacts points={totalPoints} range={range} who={totalLabel} />
      <p className="text-muted-foreground text-xs break-keep">
        {NOTES[view]}
        {clipped && breakdownFrom ? ` ${VIEW_LABELS[view]} 선은 ${monthText(breakdownFrom)}부터입니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 과목을 가를 수 없습니다.` : ""}
      </p>
      <TrendTable range={range} total={totalPoints} totalLabel={totalLabel} lines={shown.filter((l) => l.key !== "total").map((l) => ({ label: l.label, values: l.values }))} />
      {clipNote ? <p className="text-muted-foreground text-xs break-keep">{clipNote}</p> : null}
    </StatCard>
  );
}
