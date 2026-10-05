"use client";

import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { MakeupCaseRow } from "../server/read-types";
import { CommandForm } from "./command-form";
import { AllocationPicker } from "./allocation-picker";
import { SessionFields } from "./session-fields";
import { OptionPicker } from "./option-picker";
import { ReasonField, formText } from "./form-fields";

export function ReserveForm({ row, periods }: { row: MakeupCaseRow; periods: PeriodsConfig }) {
  return <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">예정 회차 예약</summary>
    <CommandForm action="reserve" revision={row.revision} label="예약 확정" payload={data => {
      const allocations = [...data.entries()].filter(([key]) => key.startsWith("allocation:")).map(([key, value]) => ({ case_id: key.slice(11), minutes: Number(value) }));
      if (!allocations.length || allocations.some(item => !Number.isSafeInteger(item.minutes) || item.minutes <= 0)) throw new Error("배정할 분량을 선택해 주세요");
      return { student_id: row.student_id, subject_key: row.subject_key, allocations,
        anchor_class_id: formText(data, "anchor_class_id"), session_date: formText(data, "session_date"),
        ...(formText(data, "session_id") ? { session_id: formText(data, "session_id") } : {
          teacher_id: formText(data, "teacher_id"), classroom_id: formText(data, "classroom_id"),
          class_id: formText(data, "class_id") || null, period_ids: data.getAll("period_ids").map(String),
        }), reason: formText(data, "reason"),
      };
    }}>
      <SessionFields subject={row.subject_key} periods={periods} />
      <OptionPicker kind="classes" name="anchor_class_id" label="실제 출결·보고서 반" subject={row.subject_key}
        initial={row.original_class_id ? { id: row.original_class_id, name: row.original_class_name ?? "원수업 반" } : undefined} required />
      <AllocationPicker row={row} /><ReasonField label="예약 메모" required={false} />
      <p className="text-sm">같은 학생·과목·날짜의 보강은 한 회차만 가능합니다. 분할 보강은 다른 날짜로 예약해 주세요.</p>
    </CommandForm>
  </details>;
}
