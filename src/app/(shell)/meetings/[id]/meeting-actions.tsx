"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, RefreshCw, Sparkles, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  deleteMeeting,
  regenerateMeetingAnalysis,
  retryMeetingProcessing,
  type DeleteMeetingState,
  type RegenerateMeetingState,
  type RetryMeetingState,
} from "@/features/meetings/server/actions";

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
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
      <Button variant="outline" onClick={() => setArmed(true)}>
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
      <Button type="button" variant="ghost" onClick={() => setArmed(false)}>
        취소
      </Button>
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
  );
}

function RetrySubmit({ label, variant }: { label: string; variant: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
      {label}
    </Button>
  );
}

function RegenerateSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      {label}
    </Button>
  );
}

/**
 * 텍스트 기반 "AI로 정리 / 다시 생성" — 저장된 전사 + 메모장(content)으로 8섹션을 즉시 (재)생성한다.
 * 오디오·AssemblyAI·웹훅 불필요(원본 녹음이 없어도, 메모만으로도 동작). "전사부터 다시"(MeetingRetryButton)와 의미 분리.
 * label = 첫 정리면 "AI로 정리", 결과가 이미 있으면 "AI 분석 다시 생성".
 */
export function MeetingRegenerateButton({
  meetingId,
  label = "AI 분석 다시 생성",
}: {
  meetingId: string;
  label?: string;
}) {
  const [state, action] = useActionState<RegenerateMeetingState, FormData>(
    regenerateMeetingAnalysis,
    undefined,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={meetingId} />
      <RegenerateSubmit label={label} />
      {state?.error ? <span className="text-chart-4 text-xs">{state.error}</span> : null}
    </form>
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
