"use client";

import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import {
  TOTAL_TOKEN,
  availableRanges,
  rangeIn,
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
} from "@/features/students/stats/model";
import { StatCard } from "./stat-card";
import { SeriesChips } from "./series-chips";
import { TrendChart } from "./trend-chart";
import { TrendFacts } from "./trend-facts";
import { TrendTable } from "./trend-table";
import type { TrendLine } from "./trend-board";

/**
 * 강좌수 추이(원장 2026-10-20 *"강좌수 추이도 당연히"* → '카드 따로') — 그날 재원생이 듣던 반을 학생마다 모두 센 수(같은 과목 반이 둘이면 2)를
 * 운영실 '강좌수 추이'와 같은 판정으로 긴 창(월별 · 주별 26주 · 연도별)에. 첫 선(전체 강좌 · 과목 관리자는 담당 과목 전체) + 프로그램별 선
 * (EiE · 인재원 영어 · 수학 — 세 프로그램 밖 과목은 첫 선에만). 아래 경계는 재원생 추이와 같다(`countFrom` — 화면이 정한다).
 * 범위·선 켜고 끄기·그래프 종류는 클라에서 바꾸고 계정에 저장한다(넘긴 칸만).
 */
export function CourseBoard({
  total,
  programs,
  countFrom,
  clipNote,
  today,
  scopeLabel,
  initial,
}: {
  total: SeriesSet;
  programs: TrendLine[];
  countFrom: string | null;
  clipNote: string | null;
  today: string;
  /** 과목 관리자의 담당 과목(예: '영어') — 있으면 첫 선이 '영어 전체 강좌'. */
  scopeLabel: string | null;
  initial: { range: TrendRange; kind: ChartKind; off: string[] };
}) {
  const [chosenRange, setRange] = useState<TrendRange>(initial.range);
  const [off, setOff] = useState<string[]>(initial.off);
  const [kind, setKind] = useState<ChartKind>(initial.kind);
  const save = (patch: Partial<StudentStatsPrefs>) => void saveStudentStatsPrefs(patch).catch(() => undefined);
  const totalLabel = scopeLabel ? `${scopeLabel} 전체 강좌` : "전체 강좌";
  // 기간 버튼은 기록 길이에 맞춘다(재원생 추이와 같은 규칙).
  const ranges = availableRanges(total, countFrom);
  const range = rangeIn(chosenRange, ranges);

  const totalPoints = pointsFor(total, range, countFrom);
  const lines = [
    { key: "total", label: totalLabel, color: tokenColor(TOTAL_TOKEN), values: totalPoints.map((p) => p.count as number | null), strong: true },
    ...programs.map((l) => ({ key: l.key, label: l.label, color: l.color, values: pointsFor(l.set, range, countFrom).map((p) => p.count as number | null), strong: false })),
  ].filter((l) => l.key === "total" || l.values.some((v) => v !== null && v > 0));
  // 막대 = 프로그램을 **쌓는다**(반 하나는 한 프로그램 — 합 = 전체 강좌) + 프로그램에 안 드는 과목의 반은 '그 밖의 과목'으로 · 합계는
  // 값 상자에만(원장 2026-10-21 첫 수업 지적과 같은 꼴). 꺾은선은 합계와 칸마다 같은 선을 뺀다(담당 과목이 하나인 과목 관리자).
  // 프로그램 선이 하나도 없으면(수학·영어 밖 과목 관리자) 쌓지 않는다 — 전부 '그 밖의 과목'으로 서면 그 화면의 뜻이 없다(리뷰 2026-10-21).
  const stacked = kind === "bar" && lines.length > 1;
  const totalValues = lines[0]!.values;
  const rest = totalValues.map((t, i) => (t === null ? null : Math.max(0, t - lines.slice(1).reduce((n, l) => n + (l.values[i] ?? 0), 0))));
  const drawnLines = [
    ...(stacked ? lines : lines.filter((l) => l.key === "total" || !l.values.every((v, i) => v === null || v === totalValues[i]))),
    ...(stacked && rest.some((v) => v !== null && v > 0) ? [{ key: "program:_rest", label: "그 밖의 과목", color: "#9aa3ad", values: rest, strong: false }] : []),
  ];
  // '그 밖의 과목'은 쌓을 때만 생기는 칸이라 '켜 둔 선이 남았나'·'마지막 하나는 못 끈다'를 볼 때 빼고 센다 — 꺾은선에서 프로그램을 다 끄고
  // 막대로 오면 회색 칸만 남던 것(재리뷰 2026-10-21 · 재원생 추이처럼 전부 켬으로 돌아간다).
  const keys = drawnLines.map((l) => l.key).filter((k) => (!stacked || k !== "total") && k !== "program:_rest");
  // 켜 둔 선이 이 범위에 하나도 없으면 전부 켠 것으로 본다(재원생 추이와 같은 규약 — 칩 표시도 같은 값).
  const offNow = keys.some((k) => !off.includes(k)) ? off.filter((k) => !stacked || k !== "total") : [];
  const shown = drawnLines.filter((l) => !offNow.includes(l.key));
  const toggle = (key: string) => {
    // 쌓은 막대에선 합계를 끄고 켜지 않는다 — 꺾은선에서 꺼 둔 합계는 그대로 남긴다(재원생 추이와 같은 규칙).
    const toggled = toggleSeries(offNow, key, keys);
    const next = stacked && off.includes("total") && !toggled.includes("total") ? [...toggled, "total"] : toggled;
    setOff(next);
    save({ courseOff: next });
  };

  return (
    <StatCard
      id="courses"
      title="강좌수 추이"
      note={`${range === "w26" ? "주마다 일요일" : range === "y" ? "해마다 연말" : "달마다 말일"} 기준(마지막 칸은 오늘) · 학생마다 듣는 반을 모두 · 운영실 '강좌수' 칸과 같은 판정`}
      tools={
        <>
          <ToolbarSegment label="기간">
            {ranges.map((r) => (
              <ToolbarSegmentItem key={r} active={range === r} onClick={() => { setRange(r); save({ courseRange: r }); }}>
                {TREND_RANGE_LABELS[r]}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
          <ToolbarSegment label="그래프">
            {(["line", "bar"] as const).map((k) => (
              <ToolbarSegmentItem key={k} active={kind === k} onClick={() => { setKind(k); save({ courseKind: k }); }}>
                {k === "line" ? "꺾은선" : "막대"}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        </>
      }
    >
      <TrendChart
        kind={kind}
        unit="개"
        labels={totalPoints.map((p) => axisLabel(p, range))}
        tooltipLabels={totalPoints.map((p) => longLabel(p, range, today))}
        series={shown.map((l) => ({
          key: l.key,
          name: l.label,
          color: l.color,
          values: l.values,
          strong: l.strong,
          ...(stacked ? (l.key === "total" ? { tooltipOnly: true } : { stack: "courses" }) : {}),
        }))}
        legend={false}
      />
      {/* 선 고르기 칩 = 범례 — 그래프 아래(원장 2026-10-22 *"다른 화면의 꺾은선도 전부 일치화"*). */}
      <SeriesChips series={drawnLines.filter((l) => !stacked || l.key !== "total").map((l) => ({ key: l.key, label: l.label, color: l.color }))} off={offNow} onToggle={toggle} />
      <TrendFacts points={totalPoints} range={range} who={totalLabel} unit="개" />
      <p className="text-muted-foreground text-xs break-keep">
        강좌수 = 그날 재원생이 듣던 반을 학생마다 모두 센 수(같은 과목 반이 둘이면 2개 · 오늘 칸은 휴원 중인 수강을 뺍니다) · 프로그램 선에
        들지 않는 과목의 반은 전체 강좌에만 듭니다 · 지난 날짜엔 그때 휴원이었는지 기록이 없어 지금 휴원 중인 수강도 셉니다.
      </p>
      <TrendTable range={range} total={totalPoints} totalLabel={totalLabel} lines={shown.filter((l) => l.key !== "total" && l.key !== "program:_rest").map((l) => ({ label: l.label, values: l.values }))} />
      {clipNote ? <p className="text-muted-foreground text-xs break-keep">{clipNote}</p> : null}
      {!ranges.includes("y") ? <p className="text-muted-foreground text-xs break-keep">연도별은 기록이 두 해에 걸치면 표시됩니다.</p> : null}
    </StatCard>
  );
}
