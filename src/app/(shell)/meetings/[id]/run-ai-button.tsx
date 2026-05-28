"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runMeetingAiAnalysis, type MeetingAiState } from "@/features/meetings/server/actions";

type Variant = "default" | "link";

function SubmitButton({ hasExisting, variant }: { hasExisting: boolean; variant: Variant }) {
  const { pending } = useFormStatus();
  if (variant === "link") {
    return (
      <button
        type="submit"
        disabled={pending}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2 disabled:opacity-50"
      >
        <Sparkles className="size-3" />
        {pending ? "분석 중…" : "재분석"}
      </button>
    );
  }
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
  variant = "default",
}: {
  meetingId: string;
  hasExisting: boolean;
  variant?: Variant;
}) {
  const [state, formAction] = useActionState<MeetingAiState, FormData>(
    runMeetingAiAnalysis,
    undefined,
  );

  return (
    <div className={variant === "link" ? "inline-flex items-center gap-2" : "flex flex-col items-end gap-1.5"}>
      <form action={formAction}>
        <input type="hidden" name="meetingId" value={meetingId} />
        <SubmitButton hasExisting={hasExisting} variant={variant} />
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
