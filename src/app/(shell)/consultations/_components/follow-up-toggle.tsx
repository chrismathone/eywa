"use client";

import { useActionState } from "react";
import { Check, Circle } from "@/components/icons/aywa-icon-compat";
import { toggleConsultationFollowUp } from "@/features/consultations/server/actions";

/**
 * 후속 조치 완료 토글 — follow_up_done 반전. ijw 학생상담 후속 완료 체크 대응.
 * `readOnly`(원생상담 읽기 권한 — 서버 게이트 `toggleConsultationFollowUp`과 같은 판정을 부모가 계산)면 누를 단추 대신
 * 지금 상태만 글자로 보인다(원장 2026-11-05 — 쓰기 단추는 그리지 않는다). 기본값은 종전 동작(누를 수 있는 토글).
 */
export function FollowUpToggle({ id, done, readOnly = false }: { id: string; done: boolean; readOnly?: boolean }) {
  const [state, formAction] = useActionState(toggleConsultationFollowUp, undefined);
  if (readOnly) {
    return (
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium ${done ? "text-chart-2" : "text-text-faint"}`}>
        {done ? <Check className="size-3" /> : <Circle className="size-3" />}
        {done ? "완료" : "미완료"}
      </span>
    );
  }
  return (
    <form action={formAction} className="inline-flex items-center">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        type="submit"
        title={done ? "완료 해제" : "완료로 표시"}
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition ${
          done
            ? "text-chart-2 hover:bg-chart-2/10"
            : "text-text-faint hover:text-foreground hover:bg-bg-soft"
        }`}
      >
        {done ? <Check className="size-3" /> : <Circle className="size-3" />}
        {done ? "완료" : "완료 표시"}
      </button>
      {state?.error ? <span className="text-danger ml-1 text-xs">{state.error}</span> : null}
    </form>
  );
}
