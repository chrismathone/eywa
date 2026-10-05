"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { MAKEUP_REASON } from "../status";
import { CommandForm } from "./command-form";
import { OptionPicker } from "./option-picker";
import { ReasonField, TextField, formText } from "./form-fields";

export function MakeupIntakeForm({ subjects }: { subjects: SubjectSetting[] }) {
  const [subject, setSubject] = useState(subjects[0]?.key ?? "");
  const [reason, setReason] = useState("absence");
  const sourceId = useRef(crypto.randomUUID());
  const router = useRouter();
  const embed = useEmbed();
  // Navigates on success, so the action skips the page re-render (no discarded action, no extra refresh).
  return <CommandForm action="intake" label="접수 · 승인 대기로 저장" refresh="client" onSaved={result => {
    const id = result.case_id ?? result.id;
    if (typeof id === "string") router.push(embed ? withEmbed(`/makeups/${id}`) : `/makeups/${id}`);
  }} payload={data => ({ student_id: formText(data, "student_id"), subject_key: subject, reason,
    source_kind: "manual", source_id: sourceId.current, note: formText(data, "note"),
    ...(reason === "additional" ? { occurrence_key: `manual:${sourceId.current}` } : {}),
    ...(reason === "additional" ? {} : { original_class_id: formText(data, "original_class_id"), original_date: formText(data, "original_date") }),
  })}>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1"><span className="block font-medium">과목</span>
        <select value={subject} required onChange={e => setSubject(e.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
          {subjects.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}
        </select>
      </label>
      <label className="space-y-1"><span className="block font-medium">발생 사유</span>
        <select value={reason} onChange={e => setReason(e.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
          {Object.entries(MAKEUP_REASON).filter(([key]) => key !== "imported").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      <OptionPicker kind="students" name="student_id" label="학생" subject={subject} required />
      {reason !== "additional" ? <OptionPicker key={subject} kind="classes" name="original_class_id" label="원수업 반" subject={subject} required /> : null}
      {reason !== "additional" ? <TextField name="original_date" label="원수업일" type="date" required /> : null}
    </div>
    <ReasonField name="note" label="접수 근거·전달 사항" required />
    <p className="text-sm">접수 후 분량 승인이 필요합니다. 기존 일정은 ‘기존 약속 연결’에서 연결해 주세요.</p>
    {reason === "additional" ? <p className="text-sm">원결석 없는 추가 지도는 접수·승인까지만 가능합니다. 예약은 출결·수납 기준 확정 후 지원합니다.</p> : null}
  </CommandForm>;
}
