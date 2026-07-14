"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { deleteExam, type ExamActionState } from "@/features/exams/server/actions";

export function ExamDeleteButton({ examId }: { examId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ExamActionState, FormData>(
    deleteExam,
    undefined,
  );
  // 삭제 성공 시 1회만 네비(가드 없으면 state.ok가 true인 동안 매 렌더 중복 push).
  const pushed = useRef(false);
  useEffect(() => {
    if (state?.ok && !pushed.current) {
      pushed.current = true;
      router.push("/exams");
    }
  }, [state, router]);

  if (!confirming) {
    return (
      <Button
        variant="outline"
        onClick={() => setConfirming(true)}
        className="hover:text-danger hover:border-danger/40"
      >
        <Trash2 className="size-4" />
        삭제
      </Button>
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
