"use client";

// 학생 로스터 표 — [이름 | 출석(일 단위 공유) | 학교학년 | 상태 | 개인 진도/과제].
// 출석 체크는 (학생,날짜) 하나의 상태를 모든 교시 블록이 미러(하루 1건 — attendance_records).
// 상태·개인진도는 교시별(class_sheet_student_marks — 키에 slot_start 포함). 아바타 금지(이름 텍스트만).
import { memo } from "react";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { handleGridNavKey } from "@/features/onescreen/components/grid-nav";
import type { ClassSheetWeekData } from "../server/queries";
import type { RosterEntry } from "../lib/grid";
import type { SheetHandlers } from "./sheet-client";
import { AttendanceCheck, StatusCell } from "./status-cell";

const noteCls =
  "border-line text-foreground w-full rounded-lg border bg-transparent px-1.5 py-1 text-[12px] outline-none focus:border-primary disabled:opacity-60";

export const RosterTable = memo(function RosterTable({
  date,
  slotStart,
  roster,
  data,
  marks,
  attendance,
  handlers,
  canEdit,
}: {
  date: string;
  slotStart: string;
  roster: RosterEntry[];
  data: ClassSheetWeekData;
  marks: Record<string, { status: string | null; progressNote: string | null }>;
  attendance: Record<string, string>;
  handlers: SheetHandlers;
  canEdit: boolean;
}) {
  const canMarkDate = data.canMarkAttendanceByDate[date] ?? false;
  return (
    <div className="border-line mt-2 border-t pt-1.5">
      <table className="w-full border-collapse text-[12px]" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 96 }} />
          <col style={{ width: 44 }} />
          <col style={{ width: 76 }} />
          <col style={{ width: 64 }} />
          <col />
        </colgroup>
        <thead>
          <tr className="text-text-faint text-left text-[10px]">
            <th className="py-0.5 font-medium">학생</th>
            <th className="py-0.5 font-medium">출석</th>
            <th className="py-0.5 font-medium">학교</th>
            <th className="py-0.5 font-medium">상태</th>
            <th className="py-0.5 font-medium">개인 진도 · 과제</th>
          </tr>
        </thead>
        <tbody>
          {roster.map((entry, rowIdx) => {
            const meta = data.students[entry.studentId];
            const mark = marks[`${entry.studentId}|${date}|${slotStart}`] ?? null;
            const attStatus = attendance[`${entry.studentId}|${date}`] ?? null;
            const rowEditable = canEdit && entry.eligible;
            return (
              <tr key={entry.studentId} className={entry.historical ? "opacity-60" : ""}>
                <td className="py-0.5 pr-1">
                  <span className="text-foreground truncate text-[12px] font-medium" title={meta?.name}>
                    {meta?.name ?? "?"}
                  </span>
                  {meta?.englishName ? (
                    <span className="text-text-faint ml-1 text-[10px]">({meta.englishName})</span>
                  ) : null}
                  {entry.historical ? (
                    <span
                      className="text-text-faint ml-1 text-[9px]"
                      title="현재 수강 대상이 아니지만 기록이 있어 표시(읽기 전용)"
                    >
                      기록
                    </span>
                  ) : null}
                </td>
                <td className="py-0.5 pr-1">
                  <AttendanceCheck
                    status={attStatus}
                    canMark={canMarkDate && rowEditable}
                    onMark={() => handlers.markPresent(entry.studentId, date)}
                  />
                </td>
                <td className="text-text-dim truncate py-0.5 pr-1 text-[11px]">
                  {meta ? schoolGradeLabel(meta.school, meta.grade) : ""}
                </td>
                <td className="py-0.5 pr-1">
                  <StatusCell
                    value={mark?.status ?? null}
                    canEdit={rowEditable}
                    onChange={(status) =>
                      handlers.saveMark(entry.studentId, date, slotStart, status, mark?.progressNote ?? null)
                    }
                  />
                </td>
                <td className="py-0.5">
                  <input
                    className={noteCls}
                    defaultValue={mark?.progressNote ?? ""}
                    disabled={!rowEditable}
                    aria-label={`${meta?.name ?? ""} 개인 진도·과제`}
                    data-nav-col="ecs-note"
                    data-nav-row={rowIdx}
                    onKeyDown={handleGridNavKey}
                    onChange={(e) =>
                      handlers.saveMark(
                        entry.studentId,
                        date,
                        slotStart,
                        mark?.status ?? null,
                        e.target.value,
                      )
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
