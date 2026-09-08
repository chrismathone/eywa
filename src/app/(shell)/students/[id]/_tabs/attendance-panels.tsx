"use client";

import { useMemo } from "react";
import type { StudentAttendanceFull } from "@/features/students/server/queries";
import {
  attendanceBadgeText,
  attendanceRecordTitle,
  attendanceStatusColor,
  attendanceStatusLabel,
  formatSlotStart,
  groupRecordsByDate,
  groupRecordsByDay,
  monthCells,
  seatDisplayName,
} from "@/features/students/attendance-tab";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function MonthCalendar({
  year,
  month,
  records,
}: {
  year: number;
  month: number;
  records: StudentAttendanceFull[];
}) {
  const byDay = useMemo(() => groupRecordsByDay(records), [records]);
  if (!year) return null;
  const cells = monthCells(year, month);

  return (
    <div className="bg-card border-line overflow-hidden rounded-2xl border">
      <div className="border-line grid grid-cols-7 border-b">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            className={`py-2 text-center text-xs font-medium ${i === 0 ? "text-danger" : i === 6 ? "text-blue" : "text-text-dim"}`}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => (
          <div key={i} className="border-line min-h-[64px] border-r border-b p-1 last:border-r-0">
            {d ? (
              <>
                <div className={`num text-xs ${i % 7 === 0 ? "text-danger" : i % 7 === 6 ? "text-blue" : "text-text-dim"}`}>
                  {d}
                </div>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {(byDay.get(d) ?? []).map((r) => (
                    <span
                      key={`${r.classId}-${r.slotStart ?? "all"}`}
                      title={attendanceRecordTitle(r)}
                      className={`truncate rounded-sm border px-1 py-0.5 text-xs font-medium ${attendanceStatusColor(r.status)}`}
                    >
                      {attendanceBadgeText(r)}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AttendanceList({ records }: { records: StudentAttendanceFull[] }) {
  const byDate = useMemo(() => groupRecordsByDate(records), [records]);
  if (byDate.length === 0)
    return <p className="text-muted-foreground py-8 text-center text-sm">이 달의 출결 기록이 없습니다</p>;

  return (
    <ul className="bg-card border-line divide-line divide-y rounded-2xl border">
      {byDate.map(([date, rows]) => (
        <li key={date} className="flex items-center gap-3 px-4 py-2">
          <span className="num text-text-dim w-24 text-xs">{date}</span>
          <div className="flex flex-1 flex-wrap gap-1.5">
            {rows.map((r) => (
              <span
                key={`${r.classId}-${r.slotStart ?? "all"}`}
                title={r.note ?? undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${attendanceStatusColor(r.status)}`}
              >
                <span>{attendanceStatusLabel(r.status)}</span>
                <span className="opacity-60">·</span>
                <span className="opacity-80">{r.className}</span>
                {listExtra(r)}
              </span>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

function listExtra(r: StudentAttendanceFull) {
  const bits = [formatSlotStart(r.slotStart), seatDisplayName(r.seatLabel), r.reporter].filter(
    (v): v is string => !!v,
  );
  if (bits.length === 0) return null;
  return (
    <>
      <span className="opacity-60">·</span>
      <span className="opacity-80">{bits.join(" · ")}</span>
    </>
  );
}
