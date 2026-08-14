"use client";

/**
 * 305 하루 표 — 시각 하나 × 여러 반 합명단.
 * 칸 구현은 주간 시트와 같다(RosterSlotCells). 이름 옆에만 반 배지를 단다.
 */
import { useMemo } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { WindowLink } from "@/components/workspace/window-link";
import { TODAY_BASE_COLS, TODAY_NAME_W } from "../lib/today-columns";
import { rosterColSpan, rosterTextCols, type RosterForm, type SheetMark } from "../lib/roster-form";
import { shortClassLabel } from "../lib/seat-day";
import { groupRosterRows, type RosterGroupKey } from "../lib/roster-order";
import type { RosterEntry } from "../lib/grid";
import { GroupToggle, GROUP_HINT } from "./roster-table";
import { RosterSlotCells } from "./roster-slot-cells";
import type { SheetHandlers } from "./sheet-client";
import type { SeatDayStudent } from "../server/seat-day-types";

const NAME_W = TODAY_NAME_W + 56; // 반 배지

export function SeatDayTable({
  date,
  slotStart,
  form,
  students,
  handlersOf,
  collapsedGroups,
  onToggleGroup,
}: {
  date: string;
  slotStart: string;
  form: RosterForm;
  students: SeatDayStudent[];
  handlersOf: (classId: string) => Pick<SheetHandlers, "setAttendance" | "clearAttendance" | "saveMark">;
  collapsedGroups: readonly RosterGroupKey[];
  onToggleGroup: (key: RosterGroupKey) => void;
}) {
  const textCols = rosterTextCols(form);
  const { rows, counts } = useMemo(() => {
    const asRoster: (RosterEntry & { row: SeatDayStudent })[] = students.map((s) => ({
      studentId: s.studentId,
      eligible: s.eligible,
      historical: s.historical,
      endedOn: s.endedOn,
      row: s,
    }));
    const out: (
      | { kind: "label"; key: RosterGroupKey; count: number }
      | { kind: "row"; entry: (typeof asRoster)[number]; navRow: number }
    )[] = [];
    const sizes = {} as Record<RosterGroupKey, number>;
    let navRow = 0;
    for (const group of groupRosterRows(asRoster, (id) => students.find((s) => s.studentId === id)?.name ?? "")) {
      sizes[group.key] = group.rows.length;
      if (group.label) out.push({ kind: "label", key: group.key, count: group.rows.length });
      if (collapsedGroups.includes(group.key)) continue;
      for (const entry of group.rows) out.push({ kind: "row", entry, navRow: navRow++ });
    }
    return { rows: out, counts: sizes };
  }, [students, collapsedGroups]);

  return (
    <table className="w-full border-collapse text-[13px]" style={{ tableLayout: "fixed" }}>
      <colgroup>
        <col style={{ width: NAME_W }} />
        {TODAY_BASE_COLS.map((w, i) => (
          <col key={i} style={{ width: w }} />
        ))}
        {textCols.map((c) => (
          <col key={c.field} style={{ width: c.width }} />
        ))}
        <col />
      </colgroup>
      <thead>
        <tr className="bg-bg-soft text-foreground text-left text-[11px]">
          <th className="rounded-l-md py-0.5 pl-1 font-bold">
            <GroupToggle
              group="active"
              collapsed={collapsedGroups.includes("active")}
              count={counts.active ?? 0}
              onToggle={() => onToggleGroup("active")}
            />
          </th>
          <th className="py-0.5 text-center font-bold">출결</th>
          <th className="py-0.5 text-center font-bold" title="수업 1회 = 1유닛(기본). 급여 시수에 반영됩니다.">
            유닛
          </th>
          <th className="py-0.5 text-center font-bold">태도</th>
          {textCols.map((col) => (
            <th key={col.field} className="py-0.5 text-center leading-tight font-bold" title={col.title}>
              {col.label}
            </th>
          ))}
          <th className="rounded-r-md py-0.5 pr-1 font-bold">특이사항</th>
        </tr>
      </thead>
      <tbody className="divide-line divide-y">
        {rows.map((row) => {
          if (row.kind === "label") {
            return (
              <tr key={`label:${row.key}`} className="bg-bg-soft">
                <td colSpan={rosterColSpan(form)} className="text-foreground px-1 py-0.5 text-[11px] font-bold" title={GROUP_HINT[row.key]}>
                  <GroupToggle
                    group={row.key}
                    collapsed={collapsedGroups.includes(row.key)}
                    count={row.count}
                    onToggle={() => onToggleGroup(row.key)}
                  />
                </td>
              </tr>
            );
          }
          const s = row.entry.row;
          const mark: SheetMark | null = s.mark;
          return (
            <tr key={`${s.classId}:${s.studentId}`}>
              <td className="py-px pr-1">
                <SeatNameCell student={s} historical={row.entry.historical} />
              </td>
              <RosterSlotCells
                entry={row.entry}
                meta={{ name: s.name, school: s.school, grade: s.grade, englishName: s.englishName }}
                date={date}
                slotStart={slotStart}
                mark={mark}
                att={s.attendance}
                canMarkDate={s.canMarkAttendance}
                canEdit={s.canEditMark}
                handlers={handlersOf(s.classId) as SheetHandlers}
                navRow={row.navRow}
                form={form}
              />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SeatNameCell({ student: s, historical }: { student: SeatDayStudent; historical: boolean }) {
  const badge = shortClassLabel(s.className);
  return (
    <div className="min-w-0">
      <WindowLink
        href={`/students/${s.studentId}`}
        title={s.name}
        className={`truncate text-[13px] font-bold underline-offset-2 hover:underline ${
          historical ? "text-text-dim" : "text-foreground"
        } ${s.endedOn ? "line-through" : ""}`}
        ariaLabel={`${s.name} 학생 정보`}
      >
        <span title={`${s.name} · ${schoolGradeLabel(s.school, s.grade)} · ${s.className}`}>
          {s.name}
        </span>
      </WindowLink>
      <span
        className="bg-bg-soft text-text-dim ml-1 inline-block max-w-[72px] truncate rounded-full px-1.5 py-px text-[10px] font-bold"
        title={s.className}
      >
        {badge}
      </span>
    </div>
  );
}
