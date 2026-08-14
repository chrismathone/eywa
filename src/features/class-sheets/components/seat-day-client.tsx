"use client";

/** 305(JJ실) 하루 입력 — 출결·마크는 반 시트와 같은 액션. */
import { useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ECS_FONT_SIZE_ZOOM } from "../font-size";
import { seatAttKey, shortClassLabel } from "../lib/seat-day";
import type { RosterGroupKey } from "../lib/roster-order";
import { DEFAULT_ECS_COLLAPSED_ROSTER_GROUPS } from "../view-prefs";
import type { SheetMark } from "../lib/roster-form";
import { SeatDayTable } from "./seat-day-table";
import { useSeatDaySaves, type SeatAtt } from "./seat-day-saves";
import type { SeatDayData, SeatDayStudent } from "../server/seat-day-types";

export function SeatDayClient({ data }: { data: SeatDayData }) {
  const [attendance, setAttendance] = useState<Record<string, SeatAtt | null>>(() => {
    const out: Record<string, SeatAtt> = {};
    for (const p of data.periods) {
      for (const s of p.students) {
        if (s.attendance) out[seatAttKey(s.classId, s.studentId, p.slotStart)] = s.attendance;
      }
    }
    return out;
  });
  const [marks, setMarks] = useState<Record<string, SheetMark>>(() => {
    const out: Record<string, SheetMark> = {};
    for (const p of data.periods) {
      for (const s of p.students) {
        if (s.mark) out[seatAttKey(s.classId, s.studentId, p.slotStart)] = s.mark;
      }
    }
    return out;
  });
  const [collapsed, setCollapsed] = useState<RosterGroupKey[]>(DEFAULT_ECS_COLLAPSED_ROSTER_GROUPS);
  const handlersOf = useSeatDaySaves(attendance, setAttendance, marks, setMarks);

  const zoom = ECS_FONT_SIZE_ZOOM[data.fontSize];
  return (
    <div className="space-y-5" style={zoom === 1 ? undefined : { zoom }}>
      {data.periods.map((p) => {
        const students: SeatDayStudent[] = p.students.map((s) => {
          const key = seatAttKey(s.classId, s.studentId, p.slotStart);
          const local = attendance[key];
          return {
            ...s,
            attendance: local === undefined ? s.attendance : local,
            mark: marks[key] ?? s.mark,
          };
        });
        const range =
          p.ends.length > 1
            ? `${p.slotStart}–${p.ends.join("·")}`
            : p.slotEnd
              ? `${p.slotStart}–${p.slotEnd}`
              : p.slotStart;
        return (
          <section key={p.slotStart} className="bg-card shadow-card rounded-2xl px-3 py-3">
            <header className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1">
              <h2 className="text-foreground text-[17px] font-extrabold tracking-tight">
                {p.periodLabel ? `${p.periodLabel} · ${range}` : range}
              </h2>
              <p className="text-text-dim text-[12px]">
                {p.classNames.map(shortClassLabel).join(" · ")} · {students.length}명
              </p>
            </header>
            <DragScrollArea className="overflow-x-auto">
              <SeatDayTable
                date={data.date}
                slotStart={p.slotStart}
                form={p.form}
                students={students}
                handlersOf={handlersOf}
                collapsedGroups={collapsed}
                onToggleGroup={(k) =>
                  setCollapsed((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
                }
              />
            </DragScrollArea>
          </section>
        );
      })}
    </div>
  );
}
