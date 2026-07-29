"use client";

// 요일 1컬럼 — 날짜 헤더 + 교시 블록 스택(조립 전용).
import { memo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

export const DayColumn = memo(function DayColumn({
  day,
  data,
  linesBySlot,
  marks,
  attendance,
  store,
  handlers,
  canEdit,
}: {
  day: GridDay;
  data: ClassSheetWeekData;
  linesBySlot: Record<string, PlanLineDTO[]>;
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
}) {
  const isToday = day.date === data.today;
  return (
    <section className="w-[540px] shrink-0 space-y-2" aria-label={`${day.date} 계획`}>
      <header className="bg-card shadow-card sticky top-0 z-10 flex items-center gap-2 rounded-2xl px-3 py-2">
        <span className={`text-[14px] font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
          {DOW_KO[day.dow]}
        </span>
        <span className="text-text-dim num text-[12px]">{day.date.slice(5).replace("-", "/")}</span>
        {isToday ? (
          <span className="border-primary text-primary rounded-full border px-1.5 py-0.5 text-[10px]">오늘</span>
        ) : null}
      </header>
      {day.slots.map((slot) => (
        <PeriodBlock
          key={slot.slotStart}
          date={day.date}
          slot={slot}
          data={data}
          lines={linesBySlot[`${day.date}|${slot.slotStart}`] ?? []}
          marks={marks}
          attendance={attendance}
          store={store}
          handlers={handlers}
          canEdit={canEdit}
        />
      ))}
    </section>
  );
});
