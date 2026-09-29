"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { FINAL_REVIEW_MAX } from "@/features/class-review/final-review";
import { saveFinalReview } from "@/features/class-review/server/final-review-actions";
import type { ReviewActionState } from "@/features/class-review/server/actions";

/**
 * 최종 총평 — 평가지당 하나(원장 2026-09-29). 평가자 코멘트와 다른 칸이다.
 * 쓸 수 있는 사람(원장·지정 인원)에겐 편집, 그 외엔 저장된 글만 읽기로.
 * ⚠️ `<form action>` 대신 onSubmit + 직접 디스패치 — React 19가 제출마다 폼을 리셋해
 *    방금 쓴 글이 옛 값으로 되돌아가는 함정([[#83]]).
 */
export function FinalReviewPanel({
  docId,
  initialText,
  meta,
  editable,
}: {
  docId: string;
  initialText: string;
  /** "원장 · 2026-09-29" 같은 작성 정보(없으면 생략) */
  meta: string | null;
  editable: boolean;
}) {
  const [text, setText] = useState(initialText);
  const [saved, setSaved] = useState(initialText);
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(saveFinalReview, undefined);
  const seenRef = useRef<ReviewActionState>(undefined);
  const submittedRef = useRef(initialText);
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.notice ?? "저장했습니다");
      setSaved(submittedRef.current);
    }
  }, [state]);

  if (!editable) {
    if (!initialText.trim()) return null;
    return (
      <div className="bg-card rounded-2xl p-5 shadow-card">
        <p className="micro mb-2">총평</p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{initialText}</p>
        {meta ? <p className="text-text-faint mt-2 text-xs">{meta}</p> : null}
      </div>
    );
  }

  const dirty = text.trim() !== saved.trim();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("docId", docId);
    fd.set("finalReview", text);
    submittedRef.current = text.trim();
    startTransition(() => action(fd));
  };

  return (
    <form onSubmit={onSubmit} className="bg-card rounded-2xl p-5 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="cr-final-review" className="micro">
          총평
        </label>
        {meta ? <span className="text-text-faint text-xs">{meta}</span> : null}
      </div>
      <textarea
        id="cr-final-review"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={FINAL_REVIEW_MAX}
        rows={4}
        placeholder="평가자 채점과 코멘트를 종합한 최종 의견 — 원장·지정 인원만 작성하며 강사 본인에게는 보이지 않습니다"
        className="border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="num text-text-faint text-xs">
          {text.length}/{FINAL_REVIEW_MAX}
        </span>
        <Button type="submit" size="sm" disabled={pending || !dirty}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          총평 저장
        </Button>
      </div>
    </form>
  );
}
