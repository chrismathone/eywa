"use client";

import { useState } from "react";
import { kstToday } from "@/lib/date-kst";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import type { MakeupCaseRow } from "../server/read-types";
import { CommandForm } from "./command-form";
import { AllocationPicker } from "./allocation-picker";
import { SessionFields } from "./session-fields";
import { OptionPicker } from "./option-picker";
import { ReasonField, formText } from "./form-fields";

export function ReserveForm({ row, periods }: { row: MakeupCaseRow; periods: PeriodsConfig }) {
  const [reset, setReset] = useState(0);
  const [date, setDate] = useState(kstToday);
  if (row.reason === "additional") return <p className="text-sm">추가 보강은 접수·승인할 수 있습니다. 예약은 아직 지원하지 않습니다.</p>;
  return <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">예정 회차 예약</summary>
    <CommandForm action="reserve" revision={row.revision} label="예약 확정" onSaved={() => setReset(current => current + 1)} payload={data => {
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
      <div onChange={event => {
        const input = event.target;
        if (input instanceof HTMLInputElement && input.name === "session_date") setDate(input.value);
      }}><SessionFields subject={row.subject_key} periods={periods} /></div>
      <OptionPicker key={`${row.student_id}:${row.subject_key}:${date}`} kind="classes" name="anchor_class_id" label="실제 출결·보고서 반" subject={row.subject_key}
        filter={{ purpose: "anchor", student_id: row.student_id, session_date: date }} disabled={!date} required />
      <p className="text-sm">실시 날짜에 수강 중인 반을 선택해 주세요. 날짜를 바꾸면 반을 다시 확인합니다.</p>
      <AllocationPicker key={reset} row={row} refreshExtras={reset > 0} /><ReasonField label="예약 메모" required={false} />
      <p className="text-sm">같은 학생·과목·날짜의 보강은 한 회차만 가능합니다. 분할 보강은 다른 날짜로 예약해 주세요.</p>
    </CommandForm>
  </details>;
}
