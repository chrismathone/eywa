"use client";

import { useActionState } from "react";
import { Trash2 } from "@/components/icons/eywa-icon-compat";
import { deleteStudentGrade } from "@/features/students/server/actions";

/** 성적 기록 삭제(휴지통) — student_grades 단일 행 삭제. ijw 성적탭 행 삭제 대응. */
export function DeleteGradeButton({
  gradeId,
  studentId,
  label,
}: {
  gradeId: string;
  studentId: string;
  label: string;
}) {
  const [state, formAction] = useActionState(deleteStudentGrade, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`"${label}" 성적 기록을 삭제할까요?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={gradeId} />
      <input type="hidden" name="studentId" value={studentId} />
      <button
        type="submit"
        title="성적 삭제"
        className="text-text-faint hover:text-danger hover:bg-danger/10 rounded p-1 transition"
      >
        <Trash2 className="size-3.5" />
      </button>
      {state?.error ? <span className="text-danger ml-1 text-xs">{state.error}</span> : null}
    </form>
  );
}
