"use client";

import { useState } from "react";
import { Search, X } from "@/components/icons/aywa-icon-compat";

import { Input } from "@/components/ui/input";
import type { StaffCalendarDay, StaffMonth } from "@/features/shuttle/parent/staff-month";
import type { Season } from "@/features/shuttle/types";
import { StaffMonthCalendar } from "./staff-month-calendar";
import { StaffMonthTable } from "./staff-month-table";
import { StaffMonthDayDialog, type DayDialogTarget } from "./staff-month-day-dialog";

/**
 * 직원 '학부모 등하원 → 월별' 본문 — 달력 + 아이별 표 + 상세 모달 하나(사용자 2026-10-16).
 * 달력 날짜 → 그날 학원 전체 · 표 칸 → 그 아이 그날. 일별 주소는 서버가 날짜마다 만들어 넘긴다(함수는 클라로 못 넘긴다).
 * 🔍 '아이별 한눈에'는 이름으로 걸러 그 아이만 본다(사용자 2026-10-16) — 이미 받은 줄을 거르기만 해 서버를 다시 부르지 않는다.
 */
export function StaffMonthView({
  weeks,
  data,
  today,
  dayHrefs,
  season,
  canEdit,
}: {
  weeks: StaffCalendarDay[][];
  data: StaffMonth;
  today: string;
  dayHrefs: Record<string, string>;
  season: Season;
  /** 등하원을 바꿀 권한(`canRecordBoarding`) — 상세 모달의 [관리자 수정하기]. */
  canEdit: boolean;
}) {
  const [target, setTarget] = useState<DayDialogTarget | null>(null);
  const [query, setQuery] = useState("");
  const q = query.replace(/\s+/g, "");
  const rows = q ? data.rows.filter((r) => r.name.replace(/\s+/g, "").includes(q)) : data.rows;
  return (
    <>
      <StaffMonthCalendar weeks={weeks} onOpenDay={(date) => setTarget({ date })} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold">아이별 한눈에</h2>
        <div className="relative w-full sm:w-64">
          <Search aria-hidden className="text-text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="아이 이름 검색"
            aria-label="아이 이름 검색"
            className="h-11 pr-10 pl-9"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색 지우기"
              className="text-text-dim hover:text-foreground absolute top-1/2 right-0 flex size-11 -translate-y-1/2 items-center justify-center"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {q && rows.length === 0 ? (
        <div className="border-line text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          &lsquo;{query.trim()}&rsquo; 이름의 아이가 없습니다.
        </div>
      ) : (
        <StaffMonthTable data={{ ...data, rows }} dayHrefs={dayHrefs} onOpenCell={(date, studentId) => setTarget({ date, studentId })} />
      )}
      {target ? (
        <StaffMonthDayDialog
          target={target}
          rows={data.rows}
          today={today}
          season={season}
          canEdit={canEdit}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}
