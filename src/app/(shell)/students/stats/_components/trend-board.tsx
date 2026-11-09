"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { StatsPeriodBar } from "@/components/stats-period-bar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { paramsForMode, periodQuery, type StatsPeriod } from "@/features/stats/period";
import { saveStudentStatsPrefs } from "@/features/students/stats/server/prefs-actions";
import { maskBefore } from "@/features/students/stats/chart-math";
import { basisMarkers, trendBasisName } from "@/features/students/stats/joined";
import {
  TOTAL_TOKEN,
  TREND_KEYS,
  availableRanges,
  clipToRecords,
  rangeIn,
  TREND_RANGE_LABELS,
  axisLabel,
  longLabel,
  pointsFor,
  toggleSeries,
  tokenColor,
  type ChartKind,
  type HistoryPoints,
  type LabelRange,
  type Point,
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

/** 과목 한 줄 · 수강 구성 한 줄 — `key`는 선 키(`subject:math` · `mix:both`). `history` = 그 선 앞에 이을 지난 기록(과목 묶음 청구 기준 추정 · 없으면 null). */
export type TrendLine = { key: string; label: string; color: string; set: SeriesSet; history?: HistoryPoints | null };

const VIEW_LABELS: Record<TrendView, string> = { subject: "과목별", mix: "수강 구성" };
const NOTES: Record<TrendView, string> = {
  subject: "과목별 = 그날 그 과목 반 수강이 걸려 있던 재원생 · 두 과목을 들으면 양쪽에 들어 합이 학원 전체보다 클 수 있습니다.",
  mix: "수강 구성 = 그날 걸려 있던 수강의 과목 묶음(영어만 · 동시수강(영어+수학) · 수학만 · 그 밖의 과목만 · 미수강) — 막대로 보면 구성을 쌓아, 모두 켜 두면 높이가 학원 전체입니다.",
};
const monthText = (ym: string) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const dayText = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/**
 * 재원생 추이(자세히) — 운영실 '재원생 추이'와 같은 판정을 셀 수 있는 달부터 · 주별 · 연도별 · **일별(고른 기간 · 최대 두 달 — 원장 2026-10-21)**로,
 * **첫 선(학원 전체 · 과목 관리자는 담당 과목 전체)과 과목별(또는 수강 구성별) 선을 한 그래프에 색깔별로**(원장 2026-10-20). 선 끝에 이름·값,
 * 마우스를 올리면 그 칸의 값.
 * 🔑 에이와로 정확히 셀 수 있는 달(`countFrom`) **앞은 '지난 기록'(0385a)으로 잇는다**(원장 2026-10-21 *"이어질 수 있는 데이터는 다 이어서"* —
 *    `joined.ts`) — **같은 선**으로 잇고 기준이 바뀌는 달에 세로 점선만 긋는다(원장 2026-10-29 *"메이크에듀 기록으로 따로 분리되어있는데"* →
 *    '같은 선 + 경계 세로선' · 뜻이 조금 다른 값이라 값 상자에 기준 이름 · 안내 `historyNote`). 과목 선도 과목 묶음 청구 기준 추정으로 잇는다
 *    (수강 구성은 지난 기록으로 가를 수 없어 비운다). 주별·일별은 에이와 기록만.
 * 🔴 과목·구성 선은 **수강 종료가 처음 기록된 달부터**(`breakdownFrom`) — 그 전에 그만둔 학생은 수강 기록이 없어 과목을 가를 수 없다.
 *    첫 선의 아래 경계(`countFrom`)는 화면(page.tsx)이 정한다. 내내 0인 선은 칩도 세우지 않는다.
 * 범위·보기·선 켜고 끄기·그래프 종류는 클라에서 바꾼다(원본을 한 번에 받아 두었다) · 바꾼 값은 계정에 저장(넘긴 칸만). 일별 기간은 **주소**(`tr…`)에
 * 싣고 서버가 그 날들을 센다(첫 수업 추이와 같은 규약 · 방식만 계정에 남긴다).
 */
export function TrendBoard({
  total,
  subjects,
  mixes,
  countFrom,
  breakdownFrom,
  clipNote,
  history,
  historyNote,
  period,
  keep,
  today,
  scopeLabel,
  initial,
}: {
  total: SeriesSet;
  subjects: TrendLine[];
  mixes: TrendLine[];
  /** 첫 선의 아래 경계(YYYY-MM) — 그 전은 에이와로 정확히 셀 수 없어 지난 기록으로 잇거나(있으면) 그리지 않는다. */
  countFrom: string | null;
  breakdownFrom: string | null;
  /** 아래 경계를 알리는 문장(화면이 이유와 함께 만든다) — 지난 기록으로 이었으면 `historyNote`가 대신 선다. */
  clipNote: string | null;
  /** 지난 기록으로 메운 월별·연도별 점(`countFrom` 앞) — 없으면 null. */
  history: HistoryPoints | null;
  historyNote: string | null;
  /** 일별 보기의 기간 — 월별·주별·연도별이면 null. */
  period: (StatsPeriod & { grain: "day" }) | null;
  /** 기간 밖 쿼리(다른 카드의 기간·과목·보기) — 일별 주소를 만들 때 그대로 둔다. */
  keep: Record<string, string | undefined>;
  today: string;
  /** 과목 관리자의 담당 과목(예: '영어') — 있으면 첫 선이 '영어 전체'이고 수강 구성 보기는 없다. */
  scopeLabel: string | null;
  initial: Pick<StudentStatsPrefs, "range" | "view" | "off"> & { kind: ChartKind };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const embed = useEmbed();
  const [pending, startTransition] = useTransition();
  const [chosenRange, setRange] = useState<TrendRange>(initial.range);
  const [chosenView, setView] = useState<TrendView>(initial.view);
  const [off, setOff] = useState<string[]>(initial.off);
  const [kind, setKind] = useState<ChartKind>(initial.kind);
  const save = (patch: Partial<StudentStatsPrefs>) => void saveStudentStatsPrefs(patch).catch(() => undefined);
  const daily = !!period;
  // 기간 버튼은 기록 길이에 맞춘다(월별 칸 12개 이하면 '최근 12개월' 없음 · 해가 하나면 '연도별' 없음 — 리뷰 2026-10-21). 지난 기록을 이은 길이로 본다.
  const ranges = availableRanges(total, countFrom, history);
  const range = rangeIn(chosenRange, ranges);
  /** 축·값 상자·표의 단위 — 일별이면 날짜(주별 점도 날짜 키라 범위로 말한다). */
  const labelRange: LabelRange = daily ? "d" : range;
  // 수강 구성 선이 없으면(과목 관리자) 과목별만.
  const view: TrendView = mixes.length ? chosenView : "subject";
  const totalLabel = scopeLabel ? `${scopeLabel} 전체` : "학원 전체";
  // 일별 보기 열기 — 주소에 기간을 싣고 서버가 그 날들을 센다(첫 수업 추이와 같은 길). 방식은 계정에.
  const openDaily = () => {
    save({ trendMode: "day" });
    const href = `${pathname}${periodQuery(paramsForMode("day", today), keep, TREND_KEYS)}#trend`;
    startTransition(() => router.push(embed ? withEmbed(href) : href, { scroll: false }));
  };

  // 일별도 에이와로 셀 수 있는 달 전은 뺀다(경계를 주소로 우회하지 못하게 · 리뷰 2026-10-21) — 지난 기록은 달 단위라 일별엔 잇지 않는다.
  const pick = (set: SeriesSet, joined: HistoryPoints | null): Point[] => (daily ? clipToRecords(set.daily ?? [], countFrom) : pointsFor(set, range, countFrom, joined));
  const totalPoints = pick(total, history);
  const hasHistory = totalPoints.some((p) => p.source === "history");
  const lines = [
    { key: "total", label: totalLabel, color: tokenColor(TOTAL_TOKEN), values: totalPoints.map((p) => p.count as number | null), strong: true },
    ...(view === "subject" ? subjects : mixes).map((l) => {
      const own = pick(l.set, l.history ?? null);
      return { key: l.key, label: l.label, color: l.color, values: alignTo(totalPoints, maskBefore(own, breakdownFrom), own), strong: false };
    }),
  ].filter((l) => l.key === "total" || l.values.some((v) => v !== null && v > 0));
  // 막대 + 수강 구성 = 구성을 **쌓는다**(영어만·동시수강·수학만·그 밖·미수강은 서로 겹치지 않아 합 = 학원 전체) · 합계는 값 상자에만
  // (합계 막대를 구성 옆에 또 세우면 한 구성뿐인 칸에 같은 막대가 둘 선다 — 원장 2026-10-21 첫 수업 지적과 같은 꼴).
  const stackMix = kind === "bar" && view === "mix";
  const totalValues = totalPoints.map((p) => p.count as number | null);
  // 그 밖에는 합계와 칸마다 같은 선을 빼고 그린다(과목 관리자의 담당 과목이 하나면 '수학 전체'와 '수학'이 같은 선이다).
  const drawnLines = stackMix ? lines : lines.filter((l) => l.key === "total" || !l.values.every((v, i) => v === null || v === totalValues[i]));
  // 쌓은 막대에선 합계가 값 상자에만 서므로 끄고 켤 선은 구성뿐 — 구성이 하나는 남게(합계만 남기면 빈 그래프 · 리뷰 2026-10-21).
  const keys = drawnLines.map((l) => l.key).filter((k) => !stackMix || k !== "total");
  // 켜 둔 선이 이 범위에 하나도 없으면(내내 0인 선만 켜 두었다) 전부 켠 것으로 본다 — 칩 표시도 같은 값(리뷰 2026-10-20: 칩은 다 꺼졌는데 선은 다 그려졌다).
  const offNow = keys.some((k) => !off.includes(k)) ? off.filter((k) => !stackMix || k !== "total") : [];
  const shown = drawnLines.filter((l) => !offNow.includes(l.key));
  const parts = shown.filter((l) => l.key !== "total");
  // 구성을 셀 수 없는 칸(수강 종료 기록 전 · 지난 기록 칸)은 합계만 회색으로 쌓아 막대 높이가 학원 전체와 같게.
  const unsplit = stackMix ? totalValues.map((t, i) => (t !== null && parts.every((l) => l.values[i] === null) ? t : null)) : [];
  const series = [
    ...shown.map((l) => ({
      key: l.key,
      name: l.label,
      color: l.color,
      values: l.values,
      strong: l.strong,
      ...(stackMix ? (l.key === "total" ? { tooltipOnly: true } : { stack: "mix" }) : {}),
    })),
    ...(unsplit.some((v) => v !== null) ? [{ key: "_unsplit", name: "구성을 셀 수 없는 칸", color: "color-mix(in srgb, var(--neutral-fill) 40%, var(--card))", values: unsplit, stack: "mix" }] : []),
  ];
  const clipped = !!breakdownFrom && totalPoints.some((p) => p.date.slice(0, 7) < breakdownFrom && p.source !== "history") && lines.length > 1;

  const toggle = (key: string) => {
    // 쌓은 막대에선 합계를 끄고 켜지 않는다 — 꺾은선에서 꺼 둔 합계는 그대로 남긴다(지우면 꺾은선으로 돌아올 때 다시 켜진다 · 리뷰 2026-10-21).
    const toggled = toggleSeries(offNow, key, keys);
    const next = stackMix && off.includes("total") && !toggled.includes("total") ? [...toggled, "total"] : toggled;
    setOff(next);
    save({ off: next });
  };

  // 일별 머리 문장은 실제로 그린 첫 날부터 — 경계(countFrom)에 걸려 앞이 잘렸으면 그 사실도(재리뷰 2026-10-21).
  const firstDay = daily ? (totalPoints[0]?.key ?? period.from) : "";
  const basis = daily
    ? `날마다 그날 기준 · ${dayText(firstDay)}~${dayText(period.to)}${firstDay > period.from && countFrom ? ` (에이와 기록이 갖춰진 ${monthText(countFrom)}부터)` : ""}${period.clipped ? " (두 달을 넘어 시작일부터 두 달만)" : ""}`
    : `${range === "w26" ? "주마다 일요일" : range === "y" ? "해마다 연말" : "달마다 말일"} 기준(마지막 칸은 오늘)`;

  return (
    <StatCard
      id="trend"
      title="재원생 추이"
      note={`${basis} · 휴원 제외 · 운영실 '재원생' 카드와 같은 판정`}
      tools={
        <>
          {daily ? (
            <StatsPeriodBar
              key={`${period.from}~${period.to}`}
              period={period}
              today={today}
              keys={TREND_KEYS}
              keep={keep}
              anchor="#trend"
              modes={["month", "day", "range"]}
              labels={{ month: "월별로" }}
              onMode={(mode) => save({ trendMode: mode === "month24" ? "month" : mode })}
            />
          ) : (
            <ToolbarSegment label="기간">
              {ranges.map((r) => (
                <ToolbarSegmentItem key={r} active={range === r} onClick={() => { setRange(r); save({ range: r }); }}>
                  {TREND_RANGE_LABELS[r]}
                </ToolbarSegmentItem>
              ))}
              <ToolbarSegmentItem active={false} onClick={openDaily} aria-busy={pending}>
                일별
              </ToolbarSegmentItem>
            </ToolbarSegment>
          )}
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
      {totalPoints.length === 0 ? (
        <p className="text-muted-foreground text-sm break-keep">
          {daily && countFrom ? `이 기간은 에이와 수강 기록이 갖춰진 ${monthText(countFrom)} 전이라 일별로 셀 수 없습니다(월별·연도별은 지난 기록으로 이어 보입니다).` : "이 기간에는 셀 수 있는 날이 없습니다."}
        </p>
      ) : (
        <TrendChart
          kind={kind}
          labels={totalPoints.map((p) => axisLabel(p, labelRange))}
          tooltipLabels={totalPoints.map((p) => (p.source === "history" ? `${longLabel(p, labelRange, today)} · ${trendBasisName(p)}` : longLabel(p, labelRange, today)))}
          series={series}
          markers={hasHistory ? basisMarkers(totalPoints.map(trendBasisName)) : []}
          legend={false}
        />
      )}
      {/* 선 고르기 칩 = 범례 — 그래프 아래(원장 2026-10-22 *"다른 화면의 꺾은선도 전부 일치화"*).
          쌓은 막대에선 합계 칩을 세우지 않는다(합계는 값 상자에만 — 눌러도 화면은 그대로인데 꺼진 상태가 저장돼 다른 보기에서 합계 선이 사라졌다 · 재리뷰 2026-10-21). */}
      <SeriesChips series={drawnLines.filter((l) => !stackMix || l.key !== "total").map((l) => ({ key: l.key, label: l.label, color: l.color }))} off={offNow} onToggle={toggle} />
      {/* 요약은 이은 축 전체 — 지난 기록 구간이 들면 뜻이 섞인 비교라 그 사실을 라벨에 적는다(리뷰 2026-10-21). */}
      <TrendFacts points={totalPoints} range={labelRange} who={hasHistory ? `${totalLabel}(지난 기록 포함)` : totalLabel} />
      <p className="text-muted-foreground text-xs break-keep">
        {NOTES[view]}
        {clipped && breakdownFrom ? ` 에이와 기록 구간의 ${VIEW_LABELS[view]} 선은 ${monthText(breakdownFrom)}부터입니다 — 그 전에 그만둔 학생은 수강 기록이 남아 있지 않아 과목을 가를 수 없습니다.` : ""}
      </p>
      <TrendTable range={labelRange} total={totalPoints} totalLabel={totalLabel} lines={shown.filter((l) => l.key !== "total").map((l) => ({ label: l.label, values: l.values }))} />
      {hasHistory && historyNote ? <p className="text-muted-foreground text-xs break-keep">{historyNote}</p> : clipNote && !daily ? <p className="text-muted-foreground text-xs break-keep">{clipNote}</p> : null}
      {!daily && !ranges.includes("y") ? <p className="text-muted-foreground text-xs break-keep">연도별은 기록이 두 해에 걸치면 표시됩니다.</p> : null}
    </StatCard>
  );
}

/**
 * 과목·구성 선 값을 첫 선의 칸(지난 기록 칸이 앞에 붙은 축)에 맞춘다 — 그 선의 지난 기록 점(과목 묶음 추정)은 그 값, 에이와 칸은 경계 전을
 * 비운 값(`masked` — `maskBefore`), 그 선에 없는 칸은 null(수강 구성의 지난 기록 칸 등). `own` = 그 선의 점(키 맞추기용).
 */
function alignTo(axis: readonly Point[], masked: readonly (number | null)[], own: readonly Point[]): (number | null)[] {
  const at = new Map(own.map((p, i) => [p.key, p.source === "history" ? p.count : (masked[i] ?? null)]));
  return axis.map((p) => at.get(p.key) ?? null);
}
