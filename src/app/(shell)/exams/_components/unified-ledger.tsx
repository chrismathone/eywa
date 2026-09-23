"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveUnifiedGrade, type UnifiedSaveState } from "@/features/grades/unified/server/actions";
import { KIND_LABEL, schoolGradeLabel, type UnifiedRow } from "@/features/grades/unified/model";
import type { GradeSheet } from "@/features/grades/types";
import type { UnifiedClass } from "@/features/grades/unified/model";
import { RosterLedgerRows } from "./roster-ledger";

function Delta({ row }: { row: UnifiedRow }) {
  if (row.delta == null || row.delta === 0) return <span>—</span>;
  const up = row.delta > 0;
  return <strong className={up ? "text-green" : "text-danger"}>{up ? "↑" : "↓"}{Math.abs(row.delta)}{row.deltaUnit === "%p" ? "%p" : ""}</strong>;
}

function LedgerRow({ row, canWrite }: { row: UnifiedRow; canWrite: boolean }) {
  const [state, action, pending] = useActionState<UnifiedSaveState, FormData>(saveUnifiedGrade, undefined);
  const initialConsultation = row.consultationDate ?? row.manualConsultationDate;
  const [consulted, setConsulted] = useState(!!initialConsultation);
  const formId = `grade-row-${row.key.replace(/[^a-z0-9]/gi, "-")}`;
  const reportDate = row.source === "report";
  const classNames = row.classes.map((cls) => cls.name).join(" / ");
  const teacherNames = [...new Set(row.classes.map((cls) => cls.teacher).filter(Boolean))].join(" / ");
  return (
    <tr className="border-line-faint border-t align-middle hover:bg-muted/40">
      <td className="px-2 py-2">
        <form id={formId} action={action} className="space-y-1">
          <input type="hidden" name="source" value={row.source} />
          <input type="hidden" name="id" value={row.sourceId} />
          <input type="hidden" name="kind" value={row.kind} />
          <input type="hidden" name="originalConsultationDate" value={initialConsultation ?? ""} />
          <input type="date" name="date" defaultValue={row.date} readOnly={reportDate} disabled={!canWrite}
            title={reportDate ? "수업보고서 날짜입니다. 날짜 수정은 보고서에서 해주세요" : "시험일"}
            className="border-line min-w-0 w-full rounded-md border bg-background px-1 py-1 text-xs" aria-label={`${row.name} 시험일`} />
        </form>
        {state?.error ? <span role="alert" className="text-danger mt-1 block text-xs">{state.error}</span> : null}
        {state?.ok ? <span role="status" className="text-green mt-1 block text-xs">저장됨</span> : null}
      </td>
      <td className="px-2 py-2 font-semibold"><Link href={`/students/${row.studentId}?tab=grades`} className="hover:text-primary hover:underline">{row.name}</Link></td>
      <td className="px-2 py-2">{schoolGradeLabel(row.school, row.grade)}</td>
      <td className="max-w-0 px-2 py-2" title={classNames}><span className="block truncate">{classNames || "—"}</span></td>
      <td className="max-w-0 px-2 py-2" title={teacherNames}><span className="block truncate">{teacherNames || "—"}</span></td>
      <td className="px-2 py-2"><span className="bg-primary-soft text-primary inline-block rounded-md px-2 py-1 font-semibold whitespace-nowrap">{KIND_LABEL[row.kind]}</span></td>
      <td className="px-2 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <input type="number" name="score" form={formId} min="0" step="0.01" defaultValue={row.score ?? ""} disabled={!canWrite}
            placeholder={row.rawScore ?? "점수"} aria-label={`${row.name} 점수`}
            className="border-line min-w-0 w-17 rounded-md border bg-background px-1 py-1 text-xs" />
          <span>/</span>
          <input type="number" name="maxScore" form={formId} min="1" max="1000" step="0.01" defaultValue={row.maxScore ?? 100} disabled={!canWrite}
            aria-label={`${row.name} 만점`} className="border-line min-w-0 w-15 rounded-md border bg-background px-1 py-1 text-xs" />
        </div>
        {row.rawScore && row.score == null ? <span title={row.rawScore} className="block truncate text-xs">원문: {row.rawScore}</span> : null}
      </td>
      <td className="px-2 py-2 text-center"><Delta row={row} /></td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1">
          <input type="checkbox" checked={consulted} disabled={!canWrite || !!row.consultationDate}
            onChange={(event) => setConsulted(event.target.checked)} aria-label={`${row.name} 성적 상담`} />
          {consulted ? (
            row.consultationDate ? <span title="학생 상담 탭의 학습·성적 상담">{row.consultationDate.slice(5)}</span>
              : <input type="date" name="consultationDate" form={formId} defaultValue={row.manualConsultationDate ?? ""}
                  required disabled={!canWrite} aria-label={`${row.name} 상담일`}
                  className="border-line min-w-0 w-27 rounded-md border bg-background px-1 py-1 text-xs" />
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-right"><button type="submit" form={formId} disabled={!canWrite || pending}
        className="border-line hover:bg-primary-soft rounded-md border px-2 py-1 font-semibold disabled:opacity-50">{pending ? "저장 중" : "저장"}</button></td>
    </tr>
  );
}

export function UnifiedLedger({ rows, canWrite, sheet, studentClasses, consultationDates }: {
  rows: UnifiedRow[]; canWrite: boolean; sheet?: GradeSheet | null;
  studentClasses?: Record<string, UnifiedClass[]>; consultationDates?: Record<string, string>;
}) {
  return (
    <div className="border-line overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1150px] table-fixed text-left text-xs">
        <colgroup><col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[10%]" /><col className="w-[15%]" /><col className="w-[9%]" /><col className="w-[10%]" /><col className="w-[16%]" /><col className="w-[6%]" /><col className="w-[9%]" /><col className="w-[5%]" /></colgroup>
        <thead className="bg-bg-soft"><tr>{["시험일", "이름", "학교학년", "반", "담임", "시험", "점수 / 만점", "증감", "상담", "저장"].map((label) => <th key={label} className="px-2 py-2 font-bold whitespace-nowrap">{label}</th>)}</tr></thead>
        <tbody>{sheet ? <RosterLedgerRows sheet={sheet} canWrite={canWrite && sheet.schemaReady && (sheet.selection.slot !== "monthly" || sheet.monthReady)}
          studentClasses={studentClasses ?? {}} consultationDates={consultationDates ?? {}} /> : null}{rows.map((row) => <LedgerRow key={row.key} row={row} canWrite={canWrite} />)}</tbody>
      </table>
      {rows.length === 0 && !sheet?.rows.length ? <p className="p-8 text-center text-sm">이 기간에 표시할 성적 기록이 없습니다.</p> : null}
    </div>
  );
}
