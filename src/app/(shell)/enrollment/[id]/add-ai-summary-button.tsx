"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { appendAiSummaryToConsultationContent } from "@/features/enrollment/server/actions";

/** AI 상담 요약을 '상담 내용'(parent_request)에 채우거나 덧붙이는 버튼. 확인 후 서버액션 호출. */
export function AddAiSummaryButton({
  consultationId,
  hasExisting,
}: {
  consultationId: string;
  hasExisting: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    const msg = hasExisting
      ? "기존 상담 내용 아래에 AI 상담 요약을 덧붙일까요?"
      : "AI 상담 요약을 상담 내용으로 채울까요?";
    if (!window.confirm(msg)) return;
    setError(null);
    start(async () => {
      const res = await appendAiSummaryToConsultationContent(consultationId);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="border-gold/40 text-gold hover:bg-gold-soft/40 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {hasExisting ? "AI 요약 상담 내용에 덧붙이기" : "AI 요약으로 상담 내용 채우기"}
      </button>
      {error ? <p className="text-danger mt-1 text-xs">{error}</p> : null}
    </div>
  );
}
