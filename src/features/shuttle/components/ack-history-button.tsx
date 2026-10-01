"use client";

import { useState, useTransition } from "react";

import { ackShuttleHistory } from "../server/history-ack-actions";

/**
 * 변경 내역 한 줄의 [확인] — 누르면 그 줄이 직원 화면에서 내려간다(장부는 그대로, 0323a · 사용자 2026-09-30).
 * 서버가 권한·학원을 다시 본다([[#77]]) — 못 누르는 사람에겐 이유가 이 자리에 선다.
 */
export function AckHistoryButton({ kind, historyId }: { kind: "ride" | "regular"; historyId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
      {error ? <span className="text-danger text-xs font-bold break-keep">{error}</span> : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await ackShuttleHistory(kind, historyId);
            if ("error" in res) setError(res.error);
          });
        }}
        className="border-primary text-primary rounded-md border px-2 py-0.5 text-xs font-bold disabled:opacity-40"
      >
        {pending ? "확인 중…" : "확인"}
      </button>
    </span>
  );
}
