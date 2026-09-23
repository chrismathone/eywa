"use client";

import { useActionState } from "react";
import type { UnifiedSaveState } from "@/features/grades/unified/server/actions";
import { createUnifiedGrade } from "@/features/grades/unified/server/create-action";
import { schoolGradeLabel } from "@/features/grades/unified/model";
import type { UnifiedStudent } from "@/features/grades/unified/server/queries";

export function NewTestForm({ students, subjects, date, canWrite }: {
  students: UnifiedStudent[]; subjects: { value: string; label: string }[]; date: string; canWrite: boolean;
}) {
  const [state, action, pending] = useActionState<UnifiedSaveState, FormData>(createUnifiedGrade, undefined);
  return <details className="bg-card shadow-card rounded-2xl text-sm">
    <summary className="text-primary cursor-pointer px-4 py-3 font-bold">+ 학생 한 명 기록 추가 <span className="text-text-dim font-normal">(일일·확인·입학테스트)</span></summary>
    <form action={action} className="border-line-faint flex flex-wrap items-end gap-3 border-t px-4 py-3">
      <label className="grid min-w-36 gap-1">학생<select name="studentId" required className="border-line rounded-md border bg-background p-2">
        {students.map((student) => <option key={student.id} value={student.id}>{student.name} · {schoolGradeLabel(student.school, student.grade)}</option>)}
      </select></label>
      <label className="grid gap-1">과목<select name="subject" required className="border-line rounded-md border bg-background p-2">
        {subjects.map((subject) => <option key={subject.value} value={subject.value}>{subject.label}</option>)}
      </select></label>
      <label className="grid gap-1">시험<select name="kind" className="border-line rounded-md border bg-background p-2">
        <option value="daily">일일테스트</option><option value="check">확인테스트</option>
        <option value="admission">입학테스트</option><option value="other">기타 시험</option>
      </select></label>
      <label className="grid gap-1">시험일<input type="date" name="date" required defaultValue={date} className="border-line rounded-md border bg-background p-2" /></label>
      <label className="grid gap-1">점수<input type="number" name="score" min="0" step="0.01" placeholder="미입력" className="border-line w-24 rounded-md border bg-background p-2" /></label>
      <label className="grid gap-1">만점<input type="number" name="maxScore" min="1" max="1000" step="0.01" required defaultValue="100" className="border-line w-24 rounded-md border bg-background p-2" /></label>
      <button disabled={!canWrite || pending || !students.length || !subjects.length} className="bg-primary rounded-md px-4 py-2 font-semibold text-white disabled:opacity-50">
        {pending ? "저장 중" : "기록 추가"}
      </button>
      {state?.error ? <p className="text-danger basis-full" role="alert">{state.error}</p> : null}
      {state?.ok ? <p className="text-green basis-full" role="status">기록을 추가했습니다. 아래 성적 원장에서 수정할 수 있습니다.</p> : null}
    </form>
  </details>;
}
