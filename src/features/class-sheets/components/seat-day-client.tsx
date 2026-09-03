"use client";

/** 305(JJ실) 하루 입력 — 출결·마크는 반 시트와 같은 액션. */
import { useState } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { ECS_FONT_SIZE_ZOOM } from "../font-size";
import { seatAttKey, shortClassLabel } from "../lib/seat-day";
import type { RosterGroupKey } from "../lib/roster-order";
import { DEFAULT_ECS_COLLAPSED_ROSTER_GROUPS } from "../view-prefs";
import { rosterTextCols, type SheetMark } from "../lib/roster-form";
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
  // 타임(교시)마다 입력 폼이 다르면 자유 입력 열 구성이 갈리고, 그 뒤 열들의 x가 블록마다 달라진다.
  // 지금 이 면은 자리(JJ)로 걸러 오므로 전 블록이 같은 폼이지만, 갈리는 날엔 **그 사실이 보여야** 한다
  // (열이 안 맞는 이유를 화면이 스스로 답하게 — 폼이 하나뿐이면 칩은 아예 안 그린다).
  const mixedForms = new Set(data.periods.map((p) => p.form)).size > 1;
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
              <h2 className="text-foreground text-lg font-extrabold tracking-tight">
                {p.periodLabel ? `${p.periodLabel} · ${range}` : range}
              </h2>
              <p className="text-text-dim text-xs">
                {p.classNames.map(shortClassLabel).join(" · ")} · {students.length}명
              </p>
              {mixedForms ? (
                <span
                  className="border-line text-text-dim rounded-full border px-2 py-px text-xs font-bold"
                  title="이 타임만 입력 칸 구성이 다릅니다 — 태도 다음 열부터 다른 타임과 위치가 달라집니다"
                >
                  {rosterTextCols(p.form)
                    .map((c) => c.label)
                    .join(" · ")}{" "}
                  칸
                </span>
              ) : null}
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
