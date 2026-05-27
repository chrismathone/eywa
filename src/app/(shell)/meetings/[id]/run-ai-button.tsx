"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runMeetingAiAnalysis, type MeetingAiState } from "@/features/meetings/server/actions";

function SubmitButton({ hasExisting }: { hasExisting: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={hasExisting ? "secondary" : "default"} disabled={pending}>
      <Sparkles className="size-4" />
      {pending ? "분석 중…" : hasExisting ? "다시 분석" : "AI 분석 실행"}
    </Button>
  );
}

export function RunMeetingAiButton({
  meetingId,
  hasExisting,
}: {
  meetingId: string;
  hasExisting: boolean;
}) {
  const [state, formAction] = useActionState<MeetingAiState, FormData>(
    runMeetingAiAnalysis,
    undefined,
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="meetingId" value={meetingId} />
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
