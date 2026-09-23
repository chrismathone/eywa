"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { GradeSaveState } from "@/features/grades/server/actions";
import { saveUnifiedRosterGrade } from "@/features/grades/unified/server/roster-action";
import { EXAM_SLOT_LABEL } from "@/features/grades/exam-slots";
import { schoolGradeLabel, type UnifiedClass } from "@/features/grades/unified/model";
import { kstDateOf } from "@/lib/date-kst";
import type { GradeSheet, GradeSheetRow } from "@/features/grades/types";

function RosterRow({ row, sheet, canWrite, classes, autoConsultation }: { row: GradeSheetRow; sheet: GradeSheet; canWrite: boolean; classes: UnifiedClass[]; autoConsultation: string | null }) {
  const [state, action, pending] = useActionState<GradeSaveState, FormData>(saveUnifiedRosterGrade, undefined);
  const [score, setScore] = useState(row.score == null ? "" : String(row.score));
  const previousConsultation = autoConsultation ?? kstDateOf(row.marks.ask1) ?? "";
  const [consulted, setConsulted] = useState(!!previousConsultation);
  const [consultationDate, setConsultationDate] = useState(previousConsultation);
  const { selection } = sheet;
  const date = row.takenOn ?? selection.date;
  const formId = `roster-${row.studentId}`;
  return <tr className="border-line-faint border-t bg-amber-50/40 align-middle">
    <td className="px-2 py-2">
      <form id={formId} action={action}>
        <input type="hidden" name="year" value={selection.year} />
        <input type="hidden" name="term" value={selection.term} />
        <input type="hidden" name="subject" value={selection.subject} />
        <input type="hidden" name="class" value={selection.classId ?? ""} />
        <input type="hidden" name="slot" value={selection.slot} />
        <input type="hidden" name="scoreId" value={row.scoreId ?? ""} />
        <input type="hidden" name="entries" value={JSON.stringify([{ studentId: row.studentId, score: score === "" ? null : Number(score) }])} />
        <input type="hidden" name="consultationDate" value={consulted ? consultationDate : ""} />
        <input type="hidden" name="originalConsultationDate" value={previousConsultation} />
        <input type="date" name="date" defaultValue={date} disabled={!canWrite}
          aria-label={`${row.name} 시험일`} className="border-line w-full rounded-md border bg-background px-1 py-1 text-xs" />
      </form>
      {state?.error ? <span className="text-danger block text-xs" role="alert">{state.error}</span> : null}
      {state?.ok ? <span className="text-green block text-xs" role="status">저장됨</span> : null}
    </td>
    <td className="px-2 py-2 font-semibold"><Link href={`/students/${row.studentId}?tab=grades`}>{row.name}</Link></td>
    <td className="px-2 py-2">{schoolGradeLabel(row.school, row.grade)}</td>
    <td className="max-w-0 px-2 py-2" title={classes.map((item) => item.name).join(" / ") || row.className}><span className="block truncate">{classes.map((item) => item.name).join(" / ") || row.className}</span></td>
    <td className="max-w-0 px-2 py-2" title={classes.map((item) => item.teacher).filter(Boolean).join(" / ")}><span className="block truncate">{classes.map((item) => item.teacher).filter(Boolean).join(" / ") || "—"}</span></td>
    <td className="px-2 py-2">{EXAM_SLOT_LABEL[selection.slot]}</td>
    <td className="px-2 py-2"><div className="flex items-center gap-1">
      <input type="number" min="0" step="0.01" max={selection.maxScore} value={score} onChange={(event) => setScore(event.target.value)}
        disabled={!canWrite} aria-label={`${row.name} 점수`} className="border-line min-w-0 w-17 rounded-md border bg-background px-1 py-1 text-xs" />
      <span>/</span><input type="number" name="max" form={formId} min="1" max="1000" step="1" defaultValue={row.maxScore ?? selection.maxScore}
        disabled={!canWrite} aria-label={`${row.name} 만점`} className="border-line min-w-0 w-15 rounded-md border bg-background px-1 py-1 text-xs" />
    </div></td>
    <td className="px-2 py-2 text-center">—</td>
    <td className="px-2 py-2"><div className="flex items-center gap-1">
      <input type="checkbox" checked={consulted} onChange={(event) => setConsulted(event.target.checked)} aria-label={`${row.name} 성적 상담`} disabled={!canWrite || !!autoConsultation} />
      {autoConsultation ? <span title="학생 상담 기록">{autoConsultation.slice(5)}</span> : consulted ? <input type="date" value={consultationDate} onChange={(event) => setConsultationDate(event.target.value)}
        aria-label={`${row.name} 상담일`} className="border-line min-w-0 w-27 rounded-md border bg-background px-1 py-1 text-xs" /> : null}
    </div></td>
    <td className="px-2 py-2 text-right"><button type="submit" form={formId} disabled={!canWrite || pending || (consulted && !consultationDate)}
      className="border-line hover:bg-primary-soft rounded-md border px-2 py-1 font-semibold disabled:opacity-50">{pending ? "저장 중" : "저장"}</button></td>
  </tr>;
}

export function RosterLedgerRows({ sheet, canWrite, studentClasses, consultationDates }: { sheet: GradeSheet; canWrite: boolean; studentClasses: Record<string, UnifiedClass[]>; consultationDates: Record<string, string> }) {
  return <>
    <tr className="bg-primary-soft text-primary"><td colSpan={10} className="px-3 py-2 font-bold">
      {selectionLabel(sheet)} · {sheet.rows.length}명
    </td></tr>
    {sheet.rows.map((row) => <RosterRow key={row.studentId} row={row} sheet={sheet} canWrite={canWrite}
      classes={studentClasses[`${row.studentId}|${sheet.selection.subject}`] ?? []} autoConsultation={consultationDates[row.studentId] ?? null} />)}
  </>;
}

function selectionLabel(sheet: GradeSheet): string {
  const { selection } = sheet;
  return `${selection.year}년 ${selection.term}학기 · ${EXAM_SLOT_LABEL[selection.slot]} 입력 명단`;
}
