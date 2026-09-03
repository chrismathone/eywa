"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setProgressAnomalyResolved } from "../server/anomaly-actions";

/**
 * "이상 없음" / "되돌리기" 버튼 — 진도 이상 신호를 사람이 끄고 켠다(0151a).
 * 실패는 조용히 넘기지 않고 버튼 옆에 한글 메시지로 띄운다(raw 에러 원문은 title 툴팁).
 */
export function AnomalyResolveButton({ eventId, resolved }: { eventId: string; resolved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await setProgressAnomalyResolved(eventId, !resolved);
      if (!res.ok) {
        setError(res.error ?? "처리하지 못했습니다");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`shrink-0 rounded-pill border px-2 py-0.5 text-xs font-bold transition disabled:opacity-50 ${
          resolved
            ? "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            : "border-danger/40 text-danger hover:bg-danger hover:text-white"
        }`}
      >
        {pending ? "처리 중…" : resolved ? "되돌리기" : "이상 없음"}
      </button>
      {error ? (
        <span className="text-danger text-xs" title={error}>
          확인 처리 실패
        </span>
      ) : null}
    </span>
  );
}
