"use client";

import { memo } from "react";
import { formatMd, formatMdW, formatRange, WEEKDAY_KO } from "../calendar";
import { dayDescription, dayStatusLabel } from "../day-schedule";
import { pctOf } from "../derive";
import { knownProgress, periodCount, periodPercent, progressUnit } from "../learning-dashboard";
import { drillLevel } from "../drilldown";
import { monthOf, resolveDay, resolveWeek, weekdaySlots } from "../focus";
import { CX, CY, DRILL_RINGS, arcPath, midAngle, polar, strokeArcPath, withGap } from "../geometry";
import { FOCUS_INK, HAIRLINE, HOLIDAY_FILL, HOLIDAY_INK, HOLIDAY_SELECTED_INK, NO_CLASS_FILL, NO_CLASS_INK, QUARTER_TINT, STATUS_FILL, STATUS_INK, TODAY_STROKE, WEEK_FILL, WEEK_INK } from "../palette";
import type { HoverTarget } from "../tooltip-content";
import { DialGuides } from "./dial-guides";
import { DialLayer } from "./dial-layer";
import { useProgressMap } from "./map-state";
import { Segment } from "./segment";
import styles from "./year-transition.module.css";

type Period = {
  key: string; title: string; subtitle: string; metric: string; label: string;
  fill: string; ink: string; accent: string; pct: number;
  current?: boolean; selected?: boolean;
  target?: HoverTarget; onSelect?: () => void;
};

const HINTS = ["분기를 누르면 월별로 확대됩니다", "월을 누르면 주별로 확대됩니다", "주를 누르면 날짜별로 확대됩니다", "날짜를 눌러 학습 내용을 확인하세요"];
const LAYER_NAMES = ["quarters", "months", "weeks", "focus"] as const;
const PROGRESS_RADIUS = (DRILL_RINGS.progress[0] + DRILL_RINGS.progress[1]) / 2;
const PROGRESS_WIDTH = DRILL_RINGS.progress[1] - DRILL_RINGS.progress[0];

/** 선택한 기간의 자식들을 원 전체에 펼친다: 4분기 → 해당 분기의 3개월 → 한 달의 주 → 한 주의 7일. */
export const DrilldownDial = memo(function DrilldownDial() {
  const { view, progress, mode, focus, selectQuarter, selectMonth, selectWeek, selectDay } = useProgressMap();
  const level = drillLevel(mode);
  const month = monthOf(view, focus.month);
  const quarter = view.quarters[month.quarter - 1]!;
  const week = resolveWeek(view, focus);
  const day = resolveDay(view, focus);
  const metric = (pct: number, planned: number) => planned === 0 ? "계획 없음" : progress.estimated ? "예정" : periodPercent(progress, pct, planned);
  let periods: Period[];

  // 종강 뒤 칸은 세우지 않는다 — 이 다이얼은 **칸 수로 각을 나눠서** 빼도 원이 채워진다(열두 달 시계와 다르다).
  // 비는 일은 없지만(고를 수 없는 분기로는 못 들어간다) 비면 원래 목록으로 돌아가 0으로 나누지 않는다.
  const liveQuarters = view.quarters.filter((q) => !q.afterEnd);
  const liveMonths = quarter.months.filter((m) => !m.afterEnd);
  if (level === 0) {
    periods = (liveQuarters.length > 0 ? liveQuarters : view.quarters).map((q) => ({
      key: `q${q.q}`, title: `${q.q}분기`, subtitle: `${q.months[0]!.month}~${q.months.at(-1)!.month}월`,
      metric: metric(q.pct, q.plannedPages), label: `${q.q}분기 · ${metric(q.pct, q.plannedPages)} · 월별로 확대`,
      fill: QUARTER_TINT[q.q].soft, ink: QUARTER_TINT[q.q].ink, accent: QUARTER_TINT[q.q].ink,
      pct: q.pct, current: q.months.some((m) => m.isCurrent), target: { kind: "quarter", q: q.q }, onSelect: () => selectQuarter(q.q),
    }));
  } else if (level === 1) {
    periods = (liveMonths.length > 0 ? liveMonths : quarter.months).map((m) => ({
      key: `m${m.month}`, title: `${m.month}월`, subtitle: m.plan?.semester ?? "계획 없음",
      metric: metric(m.pct, m.plannedPages), label: `${m.month}월 · ${metric(m.pct, m.plannedPages)} · 주별로 확대`,
      fill: STATUS_FILL[m.status], ink: STATUS_INK[m.status], accent: QUARTER_TINT[m.quarter].ink,
      pct: m.pct, current: m.isCurrent, target: { kind: "month", month: m.month }, onSelect: () => selectMonth(m.month),
    }));
  } else if (level === 2) {
    periods = month.weeks.map((w) => ({
      key: `w${w.index}`, title: `${w.index}주`, subtitle: formatRange(w.start, w.end),
      metric: metric(w.pct, w.plannedPages), label: `${month.month}월 ${w.index}주차 · ${metric(w.pct, w.plannedPages)} · 날짜별로 확대`,
      fill: WEEK_FILL[w.status], ink: focus.week === w.index ? FOCUS_INK : WEEK_INK[w.status], accent: "var(--green)",
      pct: w.pct, current: w.isCurrent, selected: focus.week === w.index,
      target: { kind: "week", month: month.month, week: w.index }, onSelect: () => selectWeek(month.month, w.index),
    }));
  } else {
    periods = weekdaySlots(week).map((d, index) => {
      if (!d) return { key: `empty-${index}`, title: `${WEEKDAY_KO[(index + 1) % 7]}요일`, subtitle: "이 달 밖", metric: "", label: "이 달 밖",
        fill: STATUS_FILL.none, ink: NO_CLASS_INK, accent: HAIRLINE, pct: 0 };
      const selected = focus.day === d.date;
      return {
        key: d.date, title: `${WEEKDAY_KO[(index + 1) % 7]}요일`, subtitle: formatMd(d.date),
        metric: d.noClassReason ? "수업 없음" : d.plannedPages ? periodCount(progress, d.donePages, d.plannedPages) : dayStatusLabel(d),
        label: `${formatMdW(d.date)} · ${dayDescription(d)}`,
        fill: d.noClassReason ? d.holidayName ? HOLIDAY_FILL : NO_CLASS_FILL : STATUS_FILL[d.status],
        ink: d.holidayName ? selected ? HOLIDAY_SELECTED_INK : HOLIDAY_INK : selected ? FOCUS_INK : d.noClassReason ? NO_CLASS_INK : STATUS_INK[d.status],
        accent: d.holidayName ? HOLIDAY_INK : "var(--green)", pct: pctOf(d.donePages, d.plannedPages),
        current: d.isToday, selected,
        target: { kind: "day", date: d.date }, onSelect: () => selectDay(d.date),
      };
    });
  }

  const aggregate = mode === "day" ? { ...day, pct: pctOf(day.donePages, day.plannedPages) }
    : level === 0 ? view : level === 1 ? quarter : level === 2 ? month : week;
  const scopeLabel = mode === "day" ? `${view.year}년 ${formatMdW(day.date)}`
    : `${view.year}년${level === 0 ? "" : level === 1 ? ` ${quarter.q}분기` : level === 2 ? ` ${month.month}월` : ` ${month.month}월 ${week.index}주`}`;
  const centerValue = mode === "day" && day.noClassReason ? "수업 없음"
    : aggregate.plannedPages === 0 ? "—" : progress.estimated ? "예정" : periodPercent(progress, aggregate.pct, aggregate.plannedPages);
  const caption = mode === "day" ? day.holidayName ?? day.record?.bookName ?? ""
    : level === 0 ? "1월부터 12월까지" : level === 1 ? `${quarter.months[0]!.month}~${quarter.months.at(-1)!.month}월`
      : level === 2 ? month.plan?.bookName ?? "" : formatRange(week.start, week.end);

  return (
    <div className={styles.dial} role="group" data-drill-level={level}
      aria-label={`${progress.studentName} 학습 진도맵 — ${scopeLabel} · ${progress.estimated ? "예상 진도" : knownProgress(progress) ? `진도율 ${aggregate.pct}%` : "진도 확인 필요"}`}>
      <DialLayer name="guides"><DialGuides periods={periods.length} /></DialLayer>
      <DialLayer name={LAYER_NAMES[level]}>
        {periods.map((period, index) => {
          const [a0, a1] = withGap([index * 360 / periods.length, (index + 1) * 360 / periods.length], 1.4);
          const point = polar(DRILL_RINGS.label, midAngle([a0, a1]));
          const d = arcPath(...DRILL_RINGS.period, a0, a1);
          return (
            <g key={period.key}>
              {period.target ? <Segment d={d} fill={period.fill} selected={period.selected}
                stroke={period.current ? TODAY_STROKE : HAIRLINE} strokeWidth={period.current ? 3 : 1}
                dashed={period.current} label={period.label} target={period.target} onSelect={period.onSelect} />
                : <path d={d} fill={period.fill} aria-hidden />}
              <g className="pointer-events-none select-none" aria-hidden>
                <path d={arcPath(...DRILL_RINGS.rim, a0, a1)} fill={HAIRLINE} />
                {period.pct > 0 ? <path d={arcPath(...DRILL_RINGS.rim, a0, a0 + (a1 - a0) * period.pct / 100)} fill={progress.learningMap ? period.pct === 100 ? "var(--goal)" : "var(--current)" : period.accent} /> : null}
                <text x={point.x} y={point.y - 26} textAnchor="middle" dominantBaseline="central" fontSize={level === 3 ? 30 : 36} fontWeight={700} fill={period.ink}>{period.title}</text>
                <text x={point.x} y={point.y + 9} textAnchor="middle" dominantBaseline="central" fontSize={23} fontWeight={500} fill={period.ink}>{period.subtitle}</text>
                <text x={point.x} y={point.y + 43} textAnchor="middle" dominantBaseline="central" fontSize={22} fontWeight={700} fill={period.ink}>{period.metric}</text>
              </g>
            </g>
          );
        })}
      </DialLayer>
      <DialLayer name="center">
        <g className="pointer-events-none select-none" textAnchor="middle" dominantBaseline="central">
          <circle cx={CX} cy={CY} r={DRILL_RINGS.center} fill="var(--card)" stroke={HAIRLINE} />
          <circle cx={CX} cy={CY} r={PROGRESS_RADIUS} fill="none" stroke="var(--bg-soft)" strokeWidth={PROGRESS_WIDTH} />
          {aggregate.pct > 0 ? <path d={strokeArcPath(PROGRESS_RADIUS, 0, aggregate.pct * 3.6)} fill="none" stroke={progress.learningMap ? aggregate.pct === 100 ? "var(--goal)" : "var(--current)" : "var(--green)"} strokeWidth={PROGRESS_WIDTH} strokeLinecap="round" /> : null}
          <text x={CX} y={CY - 95} fontSize={27} fontWeight={700} fill="var(--foreground)">{scopeLabel}</text>
          <text x={CX} y={CY - 15} fontSize={centerValue === "수업 없음" ? 54 : 84} fontWeight={700} fill={mode === "day" && day.holidayName ? HOLIDAY_INK : "var(--foreground)"}>{centerValue}</text>
          <text x={CX} y={CY + 53} fontSize={25} fill="var(--text-dim)">{progress.estimated ? `계획 ${aggregate.plannedPages}${progressUnit(progress)}` : periodCount(progress, aggregate.donePages, aggregate.plannedPages)}</text>
          <text x={CX} y={CY + 107} fontSize={24} fontWeight={600} fill={mode === "day" && day.holidayName ? HOLIDAY_INK : "var(--text-dim)"}>{caption}</text>
          <text x={CX} y={CY + 160} fontSize={20} fill="var(--text-dim)">{HINTS[level]}</text>
        </g>
      </DialLayer>
      <div className={styles.sweep} aria-hidden />
    </div>
  );
});
