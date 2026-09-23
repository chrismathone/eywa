"use client";

import { useRouter } from "next/navigation";
import { MonthGrid } from "@/app/(shell)/calendar/_components/month-grid";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { CalendarColor, CalendarEvent } from "@/features/calendar/types";

/** 하루 × 시험 종류 한 칸 — 서버가 세서 넘긴다(칩 = "일일테스트 42건"). */
export type ExamDayItem = { date: string; kind: string; label: string; count: number; href: string };

/** 시험 종류 → 칩 색. 캘린더 탭 칩과 같은 팔레트(`chipProps`)를 쓴다. */
const KIND_COLOR: Record<string, CalendarColor> = {
  daily: "blue", check: "purple", admission: "green", school: "amber", monthly: "rose", other: "neutral",
};

/**
 * 시험 일정 달력 — 캘린더 탭의 월 그리드(`MonthGrid`)를 그대로 쓴다(일~토·공휴일·오늘 표시·칩 모양이 같다).
 * 칩을 누르면 그날 그 시험의 성적 원장으로, "+N개 더"는 그날 전체 원장으로 간다.
 */
export function ExamCalendar({ month, today, items, dayHref }: {
  month: string; today: string; items: ExamDayItem[]; dayHref: Record<string, string>;
}) {
  const router = useRouter();
  const embed = useEmbed();
  const go = (href: string) => router.push(embed ? withEmbed(href) : href);
  const hrefById = new Map(items.map((item) => [`${item.date}:${item.kind}`, item.href]));
  const events: CalendarEvent[] = items.map((item) => ({
    id: `${item.date}:${item.kind}`, title: `${item.label} ${item.count}건`, memo: null,
    startDate: item.date, endDate: item.date, startTime: null, endTime: null,
    color: KIND_COLOR[item.kind] ?? "neutral", createdByName: null, source: "manual", seriesId: null, tag: null,
  }));
  return <MonthGrid month={month} today={today} events={events}
    onEventClick={(event) => { const href = hrefById.get(event.id); if (href) go(href); }}
    onMoreClick={(date) => { const href = dayHref[date]; if (href) go(href); }} />;
}
