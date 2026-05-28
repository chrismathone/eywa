"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Trash2 } from "lucide-react";
import { deleteStudentMemo, type DeleteMemoState } from "@/features/students/server/actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="text-muted-foreground hover:text-chart-4 inline-flex items-center transition"
      aria-label="삭제"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
    </button>
  );
}

export function DeleteMemoButton({ memoId, studentId }: { memoId: string; studentId: string }) {
  const [, formAction] = useActionState<DeleteMemoState, FormData>(deleteStudentMemo, undefined);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={memoId} />
      <input type="hidden" name="studentId" value={studentId} />
      <Submit />
    </form>
  );
}
