"use client";

import { useActionState } from "react";
import { LogOut } from "@/components/icons/eywa-icon-compat";
import { endSingleEnrollment } from "@/features/students/server/actions";

/** 수강 종료(×) — 단일 enrollment를 오늘자로 종료(end_date). ijw 수업탭 행 삭제(soft-delete) 대응. */
export function EndEnrollmentButton({
  enrollmentId,
  studentId,
  className,
}: {
  enrollmentId: string;
  studentId: string;
  className: string;
}) {
  const [state, formAction] = useActionState(endSingleEnrollment, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`"${className}" 수강을 오늘자로 종료할까요?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="studentId" value={studentId} />
      <button
        type="submit"
        title="이 수강을 종료합니다 (반 삭제 아님)"
        className="text-text-dim hover:text-danger hover:border-danger/30 hover:bg-danger/10 inline-flex items-center gap-1 rounded-md border border-transparent px-2 py-1 text-xs whitespace-nowrap transition"
      >
        <LogOut className="size-3" />
        수강 종료
      </button>
      {state?.error ? <span className="text-danger ml-1 text-[10px]">{state.error}</span> : null}
    </form>
  );
}
