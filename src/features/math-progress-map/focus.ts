/**
 * 초점(고른 달·주·날) 위의 조회 — 뷰 트리(`derive.ts`)에서 "지금 보는 곳"을 집어내는 함수들(순수, Vitest).
 * 요약 다섯 줄·상세 패널·일간 링이 전부 여기 것을 읽어 같은 곳을 가리킨다.
 */
import { weekdayOf, weekIndexOf } from "./calendar";
import { pctOf, type DayView, type WeekView, type YearView } from "./derive";
import type { MonthPlan, StudentProgress, ViewMode } from "./model";

export type Focus = { month: number; week: number | null; day: string | null };

/**
 * 기준일이 가리키는 초점(달·주·날). 🔴 기준일이 지도의 해(`year`) 밖이면 그 해의 끝(지난 해면 12월, 다음 해면 1월)으로
 * clamp — 다른 해의 주 번호를 그대로 쓰면 같은 번호의 엉뚱한 주가 "고른 주"가 된다.
 */
export function focusOfDate(date: string, year: number = Number(date.slice(0, 4))): Focus {
  const y = Number(date.slice(0, 4));
  if (y < year) return { month: 1, week: null, day: null };
  if (y > year) return { month: 12, week: null, day: null };
  return { month: Number(date.slice(5, 7)), week: weekIndexOf(date), day: date };
}

export function monthOf(view: YearView, month: number) {
  return view.months[Math.max(1, Math.min(12, month)) - 1]!;
}

export function weekOf(view: YearView, focus: Focus): WeekView | null {
  return monthOf(view, focus.month).weeks.find((w) => w.index === focus.week) ?? null;
}

export function dayOf(view: YearView, focus: Focus): DayView | null {
  return weekOf(view, focus)?.days.find((d) => d.date === focus.day) ?? null;
}

/**
 * 초점이 가리키는 주 — 주를 안 골랐으면 그 달의 이번 주 → 계획이 있는 첫 주 → 첫 주(달만 고른 상태에서도 일간 링이 선다).
 * ⚠️ 1일이 일요일인 달(2026년 2·3월)은 첫 주가 하루짜리라 "0/0쪽"만 보인다 — 계획 있는 주를 먼저 잡는다.
 */
export function resolveWeek(view: YearView, focus: Focus): WeekView {
  const m = monthOf(view, focus.month);
  return weekOf(view, focus) ?? m.weeks.find((w) => w.isCurrent) ?? m.weeks.find((w) => w.plannedPages > 0) ?? m.weeks[0]!;
}

/** 초점이 가리키는 날 — 날을 안 골랐으면 그 주의 오늘 → 계획 쪽이 있는 첫날 → 기록이 있는 첫날 → 첫날. */
export function resolveDay(view: YearView, focus: Focus): DayView {
  const w = resolveWeek(view, focus);
  return (
    dayOf(view, focus) ??
    w.days.find((d) => d.isToday) ??
    w.days.find((d) => d.plannedPages > 0) ??
    w.days.find((d) => d.record) ??
    w.days[0]!
  );
}

/** 초점 주의 요일 자리 — 달 첫 주가 화요일부터면 앞을 비운다(요일 위치가 흔들리지 않게). */
export function weekdaySlots(week: WeekView): (DayView | null)[] {
  const lead = (weekdayOf(week.start) + 6) % 7; // 월요일=0
  const slots: (DayView | null)[] = Array.from({ length: lead }, () => null);
  for (const d of week.days) slots.push(d);
  while (slots.length < 7) slots.push(null);
  return slots;
}

export type SummaryRow = {
  mode: ViewMode;
  label: string;
  caption: string;
  done: number;
  planned: number;
  pct: number;
};

/** 오른쪽 요약 패널의 다섯 줄 — 초점을 따라간다(기본 초점 = 기준일). */
export function summaryRows(view: YearView, focus: Focus): SummaryRow[] {
  const month = monthOf(view, focus.month);
  const week = resolveWeek(view, focus);
  const day = resolveDay(view, focus);
  const quarter = view.quarters[month.quarter - 1]!;
  const row = (mode: ViewMode, label: string, caption: string, done: number, planned: number): SummaryRow => ({
    mode,
    label,
    caption,
    done,
    planned,
    pct: pctOf(done, planned),
  });
  return [
    row("day", "일간", `${Number(day.date.slice(5, 7))}/${Number(day.date.slice(8, 10))}`, day.donePages, day.plannedPages),
    row("week", "주간", `${month.month}월 ${week.index}주`, week.donePages, week.plannedPages),
    row("month", "월간", `${month.month}월`, month.donePages, month.plannedPages),
    row("quarter", "분기", `${quarter.q}분기`, quarter.donePages, quarter.plannedPages),
    row("year", "연간", `${view.year}년`, view.donePages, view.plannedPages),
  ];
}

/** 다음에 갈 대단원 — 기준일 달 뒤의 첫 달 계획 중 지금 대단원이 아닌 것. 없으면 null(연말). */
export function nextChapterAfter(p: StudentProgress): MonthPlan | null {
  const asOfMonth = Number(p.asOf.slice(5, 7));
  return (
    [...p.yearPlan]
      .sort((a, b) => a.month - b.month)
      .find((m) => m.month > asOfMonth && !m.chapter.includes(p.curriculum.chapter)) ?? null
  );
}
