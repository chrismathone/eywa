"use client";

import { useState } from "react";
import type { MakeupParticipant, MakeupSession } from "../server/read-types";
import { CommandForm } from "./command-form";
import { OptionPicker } from "./option-picker";
import { TextField, ReasonField, formMinutes, formText } from "./form-fields";

export function ParticipationForm({ participant, session }: { participant: MakeupParticipant; session: MakeupSession }) {
  const [status, setStatus] = useState("present");
  return <details className="space-y-3"><summary className="min-h-6 cursor-pointer font-medium">참여 기록·출결 연결</summary>
    {participant.status === "no_show" ? <p className="text-sm">불참을 정정하면 자리·시간·잔량을 다시 검사합니다. 자리가 없거나 새 예약과 겹치면 다른 날짜로 다시 예약해 주세요.</p> : null}
    <CommandForm action="participation" revision={participant.revision} label="참여 기록" payload={data => ({
      participant_id: participant.id, student_id: participant.student_id, subject_key: session.subject_key,
      session_date: session.session_date, teacher_id: session.teacher_id ?? (formText(data, "teacher_id") || null),
      status, actual_minutes: status === "no_show" ? 0 : formMinutes(data, "actual_minutes"),
      attendance_record_id: formText(data, "attendance_record_id") || null,
      report_id: formText(data, "report_id") || null,
      learning_summary: formText(data, "learning_summary") || null,
      effect_key: `participant:${participant.id}:record`, reason: formText(data, "reason"),
    })}>
      <label className="block space-y-1"><span className="block font-medium">참여 결과</span>
        <select value={status} onChange={e => setStatus(e.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
          <option value="present">참여</option><option value="partial">부분 참여</option><option value="no_show">불참</option>
        </select>
      </label>
      {!session.teacher_id ? <OptionPicker kind="staff" name="teacher_id" label="실제로 지도한 강사" subject={session.subject_key} required /> : null}
      {status !== "no_show" ? <>
        <TextField name="actual_minutes" label="실제 지도(분)" type="number" min={1} max={participant.planned_minutes} step={1} initial={participant.actual_minutes ?? participant.planned_minutes} required />
        <OptionPicker kind="attendance" name="attendance_record_id" label="실제 출결 기록" subject={session.subject_key}
          filter={{ student_id: participant.student_id, session_date: session.session_date }}
          initial={participant.attendance_record_id ? { id: participant.attendance_record_id, name: "현재 연결된 출결" } : undefined} />
        <OptionPicker kind="reports" name="report_id" label="실제 지도한 보강 보고서" subject={session.subject_key}
          filter={{ student_id: participant.student_id, session_date: session.session_date }} />
        <ReasonField name="learning_summary" label="실제 지도 범위·분량 확인" required={false} />
        <p className="text-sm">정규 수업일에는 출결만으로 실시를 확인할 수 없습니다. 보강 보고서 또는 실제 지도 내용과 분량을 남겨 주세요. 출결·시수 반영은 별도로 확인합니다.</p>
      </> : <p className="text-sm">불참 기록과 함께 이 학생의 미실시 배정을 해제합니다. 보강 의무는 남아 다시 예약할 수 있습니다.</p>}
      <ReasonField label="참여 근거·정정 사유" />
    </CommandForm>
  </details>;
}

export function SubmissionForm({ participant, session, revision }: { participant: MakeupParticipant; session: MakeupSession; revision: number }) {
  return <details className="space-y-3"><summary className="min-h-6 cursor-pointer font-medium">실시 기록 검토 제출</summary>
    <CommandForm action="submit" revision={revision} label="검토 제출" payload={data => ({ participant_id: participant.id,
      report_id: formText(data, "report_id") || null, learning_summary: formText(data, "learning_summary"), homework: formText(data, "homework"),
    })}>
      <OptionPicker kind="reports" name="report_id" label="기존 수업보고서" subject={session.subject_key}
        filter={{ student_id: participant.student_id, session_date: session.session_date }} />
      <ReasonField name="learning_summary" label="지도 범위·실시 근거" required={false} />
      <ReasonField name="homework" label="과제·후속 지도" required={false} />
      <p className="text-sm">보고서 또는 지도 근거를 제출해 주세요. 제출만으로 인정 잔량이 줄어들지 않습니다.</p>
    </CommandForm>
  </details>;
}
