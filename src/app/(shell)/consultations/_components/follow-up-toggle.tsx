"use client";

import { useActionState } from "react";
import { Check, Circle } from "lucide-react";
import { toggleConsultationFollowUp } from "@/features/consultations/server/actions";

/** 후속 조치 완료 토글 — follow_up_done 반전. ijw 학생상담 후속 완료 체크 대응. */
export function FollowUpToggle({ id, done }: { id: string; done: boolean }) {
  const [state, formAction] = useActionState(toggleConsultationFollowUp, undefined);
  return (
    <form action={formAction} className="inline-flex items-center">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        title={done ? "완료 해제" : "완료로 표시"}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
          done
            ? "text-chart-2 hover:bg-chart-2/10"
            : "text-text-faint hover:text-foreground hover:bg-bg-soft"
        }`}
      >
        {done ? <Check className="size-3" /> : <Circle className="size-3" />}
        {done ? "완료" : "완료 표시"}
      </button>
      {state?.error ? <span className="text-danger ml-1 text-[10px]">{state.error}</span> : null}
    </form>
  );
}
