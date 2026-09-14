"use client";

import { formatMdW, formatRange } from "../calendar";
import { monthOf, resolveDay, resolveWeek } from "../focus";
import type { ViewMode } from "../model";
import { DayCard, WeekList } from "./detail-day-lists";
import { MonthList, YearList } from "./detail-lists";
import { useProgressMap } from "./map-state";

const HINT: Record<ViewMode, string> = {
  year: "달을 누르면 그 달의 주를 봅니다",
  quarter: "달을 누르면 그 달의 주를 봅니다",
  month: "주를 누르면 그 주의 날을 봅니다",
  week: "날을 누르면 그날 학습 내용을 봅니다",
  day: "지도의 다른 날을 누르면 그날로 옮깁니다",
};

/**
 * 상세 패널 — 보기 단위에 따라 **같은 데이터**를 다른 알갱이로: 연간 = 교재/학기 · 분기 = 대단원 · 월간 = 주(소단원) ·
 * 주간 = 날(쪽) · 일간 = 그날 학습 내용. 목록의 줄을 누르면 지도의 초점도 같이 옮겨 간다.
 */
export function ProgressDetailPanel() {
  const { mode, view, focus } = useProgressMap();
  const month = monthOf(view, focus.month);
  const week = resolveWeek(view, focus);
  const day = resolveDay(view, focus);
  const title =
    mode === "year"
      ? `${view.year}년 커리큘럼`
      : mode === "quarter"
        ? `${month.quarter}분기 진도 (${view.quarters[month.quarter - 1]!.months.map((m) => `${m.month}월`).join(" · ")})`
        : mode === "month"
          ? `${month.month}월 진도`
          : mode === "week"
            ? `${month.month}월 ${week.index}주 진도 (${formatRange(week.start, week.end)})`
            : `${formatMdW(day.date)} 학습 내용`;
  return (
    <section className="bg-card shadow-card rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-foreground text-base font-bold">{title}</h3>
        <span className="text-text-dim text-xs font-medium">{HINT[mode]}</span>
      </div>
      <div className="mt-3">
        {mode === "year" ? <YearList months={view.months} grouped /> : null}
        {mode === "quarter" ? <YearList months={view.quarters[month.quarter - 1]!.months} /> : null}
        {mode === "month" ? <MonthList month={month} /> : null}
        {mode === "week" ? <WeekList week={week} /> : null}
        {mode === "day" ? <DayCard day={day} week={week} /> : null}
      </div>
    </section>
  );
}
