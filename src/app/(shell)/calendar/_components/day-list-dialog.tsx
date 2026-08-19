"use client";

import { weekdayIndexOf } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { eventDisplayColor, eventTimeLabel, type CalendarEvent } from "@/features/calendar/types";
import { CHIP_CLASS, eventsOn } from "./month-grid";

/**
 * 하루 일정 전체 보기 — 월 그리드는 칸당 3건까지만 칩을 그리므로("+N개 더") 넘친 날은 여기서
 * 전건을 본다. fixed 오버레이(EventDialog 패턴 — 그리드 안 팝오버는 overflow에 잘린다).
 * 행 클릭 = 일정 열람/수정(부모가 EventDialog로 넘김), 등록 버튼은 쓰기 권한자만.
 */

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** "2026-08-20" → "8월 20일 (목)" — 헤더용. */
function dayTitle(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}월 ${d}일 (${DOW_KO[weekdayIndexOf(ymd)]})`;
}

export function DayListDialog({
  date,
  events,
  canWrite,
  onSelect,
  onCreate,
  onClose,
}: {
  date: string;
  /** 그 달 전체 일정 — 날짜 필터·정렬은 여기서(그리드와 같은 eventsOn). */
  events: CalendarEvent[];
  canWrite: boolean;
  onSelect: (e: CalendarEvent) => void;
  onCreate: (ymd: string) => void;
  onClose: () => void;
}) {
  const dayEvents = eventsOn(events, date);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background border-line w-full max-w-sm rounded-xl border p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={`${dayTitle(date)} 일정`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-foreground text-[15px] font-bold">{dayTitle(date)}</h2>
          <span className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-[11px] font-semibold">
            {dayEvents.length}건
          </span>
        </div>

        <div className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
          {dayEvents.length === 0 ? (
            <p className="text-text-dim py-4 text-center text-sm">일정이 없습니다</p>
          ) : (
            dayEvents.map((e) => {
              const time = eventTimeLabel(e);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onSelect(e)}
                  className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] leading-tight font-medium transition hover:opacity-80 ${CHIP_CLASS[eventDisplayColor(e)]}`}
                  title={e.tag ? `[${e.tag.name}] ${e.title}` : e.title}
                >
                  {time ? (
                    <span className="num mr-1.5">{time}</span>
                  ) : (
                    <span className="mr-1.5 opacity-70">종일</span>
                  )}
                  {e.title}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          {canWrite ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onCreate(date)}>
              이 날짜에 일정 등록
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
