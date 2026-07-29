"use client";

// 주간 그리드 — 요일을 독립 스택이 아니라 **하나의 CSS grid**로 배치해, 같은 교시(slotStart) 블록이
// 요일 간 같은 행에 나란히 놓이고 행 높이가 통일된다(구글시트 원본의 가로 정렬 재현 — "카드 크기 맞춤").
// 행 = 정렬된 slotStart 합집합, 열 = 요일. 그 요일에 없는 교시는 빈 칸(원본 시트와 동일).
import { memo, useMemo } from "react";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay } from "../lib/grid";
import type { PlanLineDTO } from "../server/actions";
import type { SheetHandlers } from "./sheet-client";
import type { SheetSaveStore } from "./use-sheet-saves";
import { PeriodBlock } from "./period-block";

const DOW_KO: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const COL_W = 540;

export const SheetGrid = memo(function SheetGrid({
  days,
  data,
  linesBySlot,
  marks,
  attendance,
  store,
  handlers,
  canEdit,
}: {
  days: GridDay[];
  data: ClassSheetWeekData;
  linesBySlot: Record<string, PlanLineDTO[]>;
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  store: SheetSaveStore;
  handlers: SheetHandlers;
  canEdit: boolean;
}) {
  // 행 축 = 보이는 요일들의 slotStart 합집합(정렬) — 같은 교시가 요일 간 같은 행에 놓인다.
  const slotRows = useMemo(() => {
    const set = new Set<string>();
    for (const day of days) for (const slot of day.slots) set.add(slot.slotStart);
    return [...set].sort();
  }, [days]);

  if (days.length === 0) {
    // 랜딩 빈 상태와 동일 스타일(부모가 flex가 아니라 self-center는 무효 — 카드형으로 통일)
    return (
      <p className="bg-card shadow-card text-text-dim rounded-2xl px-4 py-6 text-sm">
        이 주에는 수업이 없습니다.
      </p>
    );
  }

  return (
    <div
      className="grid content-start gap-x-3 gap-y-2 pb-2"
      style={{ gridTemplateColumns: `repeat(${days.length}, ${COL_W}px)` }}
    >
      {days.map((day, ci) => {
        const isToday = day.date === data.today;
        return (
          <header
            key={day.date}
            // cursor-default — DragScrollArea의 cursor-grab이 헤더까지 덮지 않게(period-block과 동일)
            className="bg-card shadow-card sticky top-0 z-10 flex cursor-default items-center gap-2 rounded-2xl px-3 py-2"
            style={{ gridColumn: ci + 1, gridRow: 1 }}
          >
            <span className={`text-[14px] font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
              {DOW_KO[day.dow]}
            </span>
            <span className="text-text-dim num text-[12px]">{day.date.slice(5).replace("-", "/")}</span>
            {isToday ? (
              <span className="border-primary text-primary rounded-full border px-1.5 py-0.5 text-[10px]">오늘</span>
            ) : null}
          </header>
        );
      })}

      {slotRows.map((slotStart, ri) =>
        days.map((day, ci) => {
          const slot = day.slots.find((s) => s.slotStart === slotStart);
          if (!slot) return null; // 그 요일에 없는 교시 = 빈 칸(원본 시트와 동일)
          return (
            <div
              key={`${day.date}|${slotStart}`}
              className="min-w-0 [&>article]:h-full"
              style={{ gridColumn: ci + 1, gridRow: ri + 2 }}
            >
              <PeriodBlock
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
            </div>
          );
        }),
      )}
    </div>
  );
});
