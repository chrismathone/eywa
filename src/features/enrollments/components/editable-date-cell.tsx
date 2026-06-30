"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import {
  updateEnrollmentDates,
  type UpdateEnrollmentDatesState,
} from "@/features/enrollments/server/actions";

/**
 * 수강 시작/종료일 더블클릭 인라인 수정 (owner 전용 — 노출은 호출부가 게이트).
 * 학생 상세 수업 탭 + 수업 상세 로스터 공용. 종료는 비워서 저장하면 "재원중"으로 복귀.
 * 성공 시 1회만 닫고 배경 갱신(#67: state 객체 동일성 가드 — 매 제출이 새 객체라
 * 재오픈해도 stale 성공이 다시 발화하지 않음).
 */
export function EditableDateCell({
  enrollmentId,
  field,
  value,
}: {
  enrollmentId: string;
  field: "start" | "end";
  value: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<UpdateEnrollmentDatesState, FormData>(
    updateEnrollmentDates,
    undefined,
  );
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      setEditing(false);
      router.refresh();
    }
  }, [state, router]);

  if (!editing) {
    return (
      <button
        type="button"
        onDoubleClick={() => setEditing(true)}
        title="더블클릭하여 수정"
        className="hover:bg-bg-soft -mx-1 cursor-text rounded px-1 py-0.5 text-left transition"
      >
        {field === "start" ? (
          <span className="text-text-dim num">{value}</span>
        ) : value ? (
          <span className="text-amber num font-medium">~{value}</span>
        ) : (
          <span className="text-primary font-medium">재원중</span>
        )}
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <input type="hidden" name="field" value={field} />
      <input
        type="date"
        name="value"
        defaultValue={value ?? ""}
        autoFocus
        required={field === "start"}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="border-border bg-card text-foreground num rounded border px-1.5 py-0.5 text-xs"
      />
      <button
        type="submit"
        disabled={pending}
        title="저장"
        className="text-primary hover:bg-primary/10 rounded p-1 transition disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        title="취소"
        className="text-text-faint hover:bg-bg-soft rounded p-1 transition"
      >
        <X className="size-3.5" />
      </button>
      {field === "end" ? (
        <span className="text-text-faint ml-0.5 text-[10px] whitespace-nowrap">비우면 재원중</span>
      ) : null}
      {state?.error ? <span className="text-danger ml-0.5 text-[10px]">{state.error}</span> : null}
    </form>
  );
}
