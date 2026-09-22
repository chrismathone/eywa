"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "@/components/icons/aywa-icon-compat";
import {
  deleteStudentConsultation,
  type DeleteConsultationState,
} from "@/features/consultations/server/actions";

function ConfirmSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-chart-4 hover:bg-chart-4/10 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      확인
    </button>
  );
}

/**
 * 학생상담 삭제 — 2단계 확인(클릭 → 확인/취소). 카드 stretched-link 위에서 쓰려면
 * 부모에서 relative z-10 컨테이너로 감싼다(나란히 두는 곳은 그대로).
 */
export function ConsultationDeleteButton({
  id,
  studentId,
  redirectTo,
  label = "삭제",
}: {
  id: string;
  studentId?: string;
  redirectTo?: string;
  label?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [state, action] = useActionState<DeleteConsultationState, FormData>(
    deleteStudentConsultation,
    undefined,
  );

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="text-text-dim hover:text-chart-4 inline-flex items-center gap-1 text-xs transition"
        aria-label="상담 삭제"
      >
        <Trash2 className="size-3.5" />
        {label}
      </button>
    );
  }

  return (
    <form action={action} className="inline-flex items-center gap-1">
      <input type="hidden" name="id" value={id} />
      {studentId ? <input type="hidden" name="studentId" value={studentId} /> : null}
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}
      <ConfirmSubmit />
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-text-dim hover:text-foreground px-1 text-xs"
      >
        취소
      </button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}
