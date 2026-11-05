"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, Sparkles } from "@/components/icons/aywa-icon-compat";
import { appendAiSummaryToConsultationContent } from "@/features/enrollment/server/actions";

/**
 * 상담 내용 하단 AI 액션 2종 — 같은 컴팩트 버튼으로 가로 정렬.
 * ① AI 요약 채우기/덧붙이기: AI '분석'의 상담 요약을 parent_request에 직접 써넣는다(서버액션).
 * ② AI가 정리한 상담 내용 보기: AI '폼 추출기'가 뽑은 상담내용 후보를 펼쳐 보고 수정에서 반영(직접 안 씀).
 * 🔴 읽기 권한(`canWrite=false`)이면 쓰기 길(①·'수정에서 반영하기')을 그리지 않는다 — 후보 보기만 남는다(원장 2026-11-05 · write-lock.ts).
 *    판정은 페이지가 서버 게이트와 같은 `canWriteTenant(…,"enrollment")`로 내려 준다.
 */
const BTN =
  "border-gold/40 text-gold hover:bg-gold-soft/40 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50";

export function ConsultationContentActions({
  consultationId,
  hasExisting,
  canAddSummary,
  aiSuggestion,
  editHref,
  canWrite = true,
}: {
  consultationId: string;
  hasExisting: boolean;
  canAddSummary: boolean;
  aiSuggestion: string | null;
  editHref: string;
  canWrite?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showSuggestion, setShowSuggestion] = useState(false);

  function add() {
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

  const showAdd = canAddSummary && canWrite;
  if (!showAdd && !aiSuggestion) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {showAdd ? (
          <button type="button" onClick={add} disabled={pending} className={BTN}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {hasExisting ? "AI 요약 덧붙이기" : "AI 요약으로 채우기"}
          </button>
        ) : null}
        {aiSuggestion ? (
          <button type="button" onClick={() => setShowSuggestion((v) => !v)} className={BTN}>
            <Sparkles className="size-3.5" />
            AI가 정리한 상담 내용 {showSuggestion ? "숨기기" : "보기"}
          </button>
        ) : null}
      </div>
      {error ? <p className="text-danger text-xs">{error}</p> : null}
      {showSuggestion && aiSuggestion ? (
        <div className="border-gold/40 bg-gold-soft/30 rounded-md border px-3 py-2">
          <p className="text-text-dim max-h-48 overflow-y-auto text-xs leading-relaxed break-words whitespace-pre-wrap">
            {aiSuggestion}
          </p>
          {canWrite ? (
            <Link
              href={editHref}
              className="text-gold hover:text-gold/80 mt-2 inline-flex items-center gap-1 text-xs font-medium"
            >
              수정에서 반영하기 <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
