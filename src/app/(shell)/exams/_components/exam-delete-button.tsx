"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteExam, type ExamActionState } from "@/features/exams/server/actions";

export function ExamDeleteButton({ examId }: { examId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ExamActionState, FormData>(
    deleteExam,
    undefined,
  );
  if (state?.ok) queueMicrotask(() => router.push("/exams"));

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="border-line text-text-dim hover:text-danger hover:border-danger/40 inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition"
      >
        <Trash2 className="size-3.5" />
        삭제
      </button>
    );
  }

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={examId} />
      <span className="text-danger text-xs">삭제할까요?</span>
      <button
        type="submit"
        disabled={pending}
        className="bg-danger text-white inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        예, 삭제
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="border-line text-text-dim hover:bg-bg-soft rounded-md border px-2.5 py-1 text-xs"
      >
        취소
      </button>
      {state?.error ? <span className="text-danger text-xs">{state.error}</span> : null}
    </form>
  );
}
