"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Sparkles } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { runAiAnalysis, type RunAiState } from "@/features/enrollment/server/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Sparkles className="size-4" />
      {pending ? "분석 중…" : "AI 분석 실행"}
    </Button>
  );
}

export function RunAiButton({ consultationId }: { consultationId: string }) {
  const [state, formAction] = useActionState<RunAiState, FormData>(runAiAnalysis, undefined);

  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <input type="hidden" name="consultationId" value={consultationId} />
        <SubmitButton />
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
