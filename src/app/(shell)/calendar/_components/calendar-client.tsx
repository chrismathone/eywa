"use client";

import Link from "next/link";
import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/features/calendar/types";
import { MonthGrid } from "./month-grid";
import { EventDialog, type DialogState } from "./event-dialog";

/**
 * 캘린더 클라 껍데기 — 월 내비(링크) + 그리드 + 일정 다이얼로그 상태.
 * 데이터는 서버(page)가 내려준 직렬화 배열이라 그리드 통째로 클라여도 무겁지 않다(월 수십 건 규모).
 */
export function CalendarClient({
  month,
  monthLabel,
  prevMonth,
  nextMonth,
  isCurrentMonth,
  today,
  events,
  canWrite,
}: {
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  isCurrentMonth: boolean;
  today: string;
  events: CalendarEvent[];
  canWrite: boolean;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);

  function openEvent(e: CalendarEvent) {
    setDialog(canWrite ? { mode: "edit", event: e } : { mode: "view", event: e });
  }

  return (
    <div className="space-y-3">
      {/* 상단 내비 — 월 이동은 URL(?m=)이라 새로고침·딥링크·창 타이틀이 공짜. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/calendar?m=${prevMonth}`}
            className="border-line text-text-dim hover:text-foreground hover:border-primary/50 flex size-8 items-center justify-center rounded-lg border transition"
            aria-label="이전 달"
          >
            <EyIcon name="chevronLeft" size={16} />
          </Link>
          <h2 className="text-foreground min-w-[110px] text-center text-[17px] font-bold tracking-tight">
            {monthLabel}
          </h2>
          <Link
            href={`/calendar?m=${nextMonth}`}
            className="border-line text-text-dim hover:text-foreground hover:border-primary/50 flex size-8 items-center justify-center rounded-lg border transition"
            aria-label="다음 달"
          >
            <EyIcon name="chevronRight" size={16} />
          </Link>
          {!isCurrentMonth ? (
            <Button variant="outline" size="sm" render={<Link href="/calendar" />}>
              오늘
            </Button>
          ) : null}
        </div>
        {canWrite ? (
          <Button onClick={() => setDialog({ mode: "create", date: isCurrentMonth ? today : `${month}-01` })}>
            <EyIcon name="plus" size={16} />
            일정 등록
          </Button>
        ) : null}
      </div>

      <MonthGrid month={month} today={today} events={events} onEventClick={openEvent} />

      {dialog ? <EventDialog state={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
