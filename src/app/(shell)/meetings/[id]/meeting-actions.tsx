"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteMeeting,
  retryMeetingProcessing,
  type DeleteMeetingState,
  type RetryMeetingState,
} from "@/features/meetings/server/actions";

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      삭제 확인
    </Button>
  );
}

/** 회의록 삭제 — 2단계 확인. 성공 시 서버가 /meetings로 redirect. */
export function MeetingDeleteButton({ meetingId }: { meetingId: string }) {
  const [armed, setArmed] = useState(false);
  const [state, action] = useActionState<DeleteMeetingState, FormData>(deleteMeeting, undefined);

  if (!armed) {
    return (
      <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
        <Trash2 className="size-4" />
        삭제
      </Button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={meetingId} />
      <input type="hidden" name="redirectTo" value="/meetings" />
      <DeleteSubmit />
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        취소
      </Button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}

function RetrySubmit({ label, variant }: { label: string; variant: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {label}
    </Button>
  );
}

/**
 * 음성 회의록 AssemblyAI 재제출 — 실패 복구(failed) + 완료 건 "다시 분석" 공용.
 * 재제출 시 status를 transcribing으로 리셋하므로 webhook의 'already completed' 가드를 자연 통과,
 * 8섹션 리포트가 새로 생성된다.
 */
export function MeetingRetryButton({
  meetingId,
  label = "재시도",
  variant = "default",
  outerClassName = "mt-3",
}: {
  meetingId: string;
  label?: string;
  variant?: "default" | "outline";
  outerClassName?: string;
}) {
  const [state, action] = useActionState<RetryMeetingState, FormData>(
    retryMeetingProcessing,
    undefined,
  );
  return (
    <form action={action} className={`flex items-center gap-2 ${outerClassName}`}>
      <input type="hidden" name="id" value={meetingId} />
      <RetrySubmit label={label} variant={variant} />
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}
