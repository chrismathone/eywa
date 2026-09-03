"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { dotProps } from "@/features/calendar/color";
import type { CalendarColor } from "@/features/calendar/types";
import { EventRow, type EventRowData } from "./event-row";

/**
 * 분석 요약표의 **칸 상세 모달** — 그 칸(태그 × 연도 × 월)을 만든 일정 전건.
 * 줄 모양은 연대기와 같은 [EventRow] 공용(같은 일정이 두 곳에서 다르면 같은 건인지 되짚게 된다).
 *
 * ⚠️ 목록을 다시 세지 않는다 — 호출부가 **표 건수와 같은 필터**로 뽑아 넘긴다(둘이 갈리면 거짓말).
 */

/** 표의 한 행 머리(태그·태그없음·전체) — 모달 제목이 어느 칸에서 왔는지 말한다. */
export type CellGroup = { key: string; label: string; color?: CalendarColor; strong?: boolean };
/** 열린 모달이 가리키는 칸 — month=null이면 그 해 전체(합계 열). */
export type PickedCell = { group: CellGroup; year: number; month: number | null };

export function StatsCellDialog({
  picked,
  events,
  onClose,
}: {
  picked: PickedCell;
  /** 이 칸에 해당하는 일정(이미 좁혀 정렬된 목록). */
  events: EventRowData[];
  onClose: () => void;
}) {
  // Escape로 닫기 — 오버레이 클릭·닫기 버튼과 같은 출구를 키보드에도 준다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dot = picked.group.color ? dotProps(picked.group.color) : null;
  const where =
    picked.month === null ? `${picked.year}년 전체` : `${picked.year}년 ${picked.month}월`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-background border-line flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={`${picked.group.label} ${where} 일정`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-foreground flex items-center gap-1.5 text-base font-bold">
            {dot ? (
              <span
                className={`size-2.5 shrink-0 rounded-full ${dot.className}`}
                style={dot.style}
                aria-hidden
              />
            ) : null}
            {picked.group.label}
            <span className="text-text-dim num font-normal">· {where}</span>
          </h2>
          <span className="text-text-dim text-xs">
            일정 <span className="num text-foreground font-semibold">{events.length}</span>건
          </span>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-text-faint py-4 text-center text-xs">표시할 일정이 없습니다</p>
          ) : (
            <ul className="divide-line/60 divide-y">
              {events.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
