"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Sparkles } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  runStudentCareAnalysis,
  type StudentCareState,
} from "@/features/consultations/server/actions";

function SubmitButton({ hasExisting }: { hasExisting: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={hasExisting ? "secondary" : "default"} disabled={pending}>
      <Sparkles className="size-4" />
      {pending ? "분석 중…" : hasExisting ? "케어 분석 갱신" : "AI 케어 분석"}
    </Button>
  );
}

export function RunCareAiButton({
  studentId,
  hasExisting,
}: {
  studentId: string;
  hasExisting: boolean;
}) {
  const [state, formAction] = useActionState<StudentCareState, FormData>(
    runStudentCareAnalysis,
    undefined,
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="studentId" value={studentId} />
        <SubmitButton hasExisting={hasExisting} />
      </form>
      {state?.error ? (
        <p className="text-destructive inline-flex items-center gap-1 text-xs">
          <AlertCircle className="size-3" />
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
