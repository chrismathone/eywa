"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { MAKEUP_ACTION, MAKEUP_REASON } from "../status";
import { CommandForm } from "./command-form";
import { OptionPicker } from "./option-picker";
import { ReasonField, TextField, formText } from "./form-fields";

export function MakeupIntakeForm({ subjects }: { subjects: SubjectSetting[] }) {
  const [subject, setSubject] = useState(subjects[0]?.key ?? "");
  const [reason, setReason] = useState("absence");
  const [studentId, setStudentId] = useState("");
  const [originalDate, setOriginalDate] = useState("");
  const originalDateLabel = reason === "class_cancelled" ? "휴강일" : "결석일";
  const sourceId = useRef(crypto.randomUUID());
  const router = useRouter();
  const embed = useEmbed();
  // Navigates on success, so the action skips the page re-render (no discarded action, no extra refresh).
  return <CommandForm action="intake" label={MAKEUP_ACTION.intake} refresh="client" onSaved={result => {
    const id = result.case_id ?? result.id;
    if (typeof id === "string") {
      const href = `/makeups/${id}${result.existing === true ? "?existing=1" : ""}`;
      router.push(embed ? withEmbed(href) : href);
    }
  }} payload={data => ({ student_id: formText(data, "student_id"), subject_key: subject, reason,
    source_kind: "manual", source_id: sourceId.current, note: formText(data, "note"),
    ...(reason === "additional" ? { occurrence_key: `manual:${sourceId.current}` } : {}),
    ...(reason === "additional" ? {} : { original_class_id: formText(data, "original_class_id"), original_date: formText(data, "original_date") }),
  })}>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1"><span className="block font-medium">과목</span>
        <select value={subject} required onChange={e => { setSubject(e.target.value); setStudentId(""); }} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
          {subjects.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="block font-medium">보강 사유</span>
        <select value={reason} onChange={e => setReason(e.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
          {Object.entries(MAKEUP_REASON).filter(([key]) => key !== "imported").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <OptionPicker key={subject} kind="students" name="student_id" label="학생" searchPlaceholder="학생 이름 검색" subject={subject} required
        onSelect={row => setStudentId(row?.id ?? "")} />
      {reason !== "additional" ? <TextField name="original_date" label={originalDateLabel} type="date" required initial={originalDate} onChange={setOriginalDate} /> : null}
      {reason !== "additional" ? <div className="space-y-1">
        <OptionPicker key={`${subject}:${studentId}:${originalDate}`} kind="classes" name="original_class_id" label="반"
          searchPlaceholder="반 이름 검색" subject={subject} required disabled={!studentId || !originalDate}
          filter={{ purpose: "original", student_id: studentId, session_date: originalDate }} />
        <p className="text-sm">학생과 {originalDateLabel}을 먼저 선택해 주세요. 해당 날짜에 수강한 반을 표시합니다.</p>
      </div> : null}
    </div>
    <ReasonField name="note" label="메모" required />
    <p className="text-sm">접수 후 담당자가 보강 시간을 승인합니다. 이미 예약한 보강은 ‘{MAKEUP_ACTION.link_legacy}’에서 연결해 주세요.</p>
    {reason === "additional" ? <p className="text-sm">결석분이 아닌 추가 보강은 접수·승인까지만 가능합니다. 보강 예약은 출결·수납 기준 확정 후 지원합니다.</p> : null}
  </CommandForm>;
}
