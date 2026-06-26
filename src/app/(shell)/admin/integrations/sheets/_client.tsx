"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setSheetsExportEnabled } from "@/features/integrations/server/actions";
import type { IntegrationStatus } from "@/features/integrations/server/queries";

export function SheetsClient({ status }: { status: IntegrationStatus }) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setError(null);
    start(async () => {
      const res = await setSheetsExportEnabled(next);
      if (res?.error) setError(res.error);
      else setEnabled(next);
    });
  }

  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-semibold">구글 시트 내보내기 연동</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            켜면 <strong>시간표</strong> 화면에 <strong>구글 시트</strong> 내보내기 버튼이 나타납니다(원장 전용).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="구글 시트 내보내기 연동"
          onClick={toggle}
          disabled={pending}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            enabled ? "bg-primary" : "bg-line-strong"
          }`}
        >
          <span
            className={`flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
              enabled ? "translate-x-[22px]" : "translate-x-0.5"
            }`}
          >
            {pending ? <Loader2 className="text-text-dim size-3 animate-spin" /> : null}
          </span>
        </button>
      </div>

      {error ? <p className="text-chart-4 text-sm">{error}</p> : null}

      <p className="text-muted-foreground border-t pt-3 text-[11px]">
        대상 스프레드시트·서비스 계정 설정은 <strong>관리자에게 문의</strong>하세요.
        {status.lastSyncedAt
          ? ` · 마지막 동기화 ${new Date(status.lastSyncedAt).toLocaleString("ko-KR")}`
          : null}
        {status.lastError ? (
          <span className="text-chart-4"> · 마지막 오류: {status.lastError}</span>
        ) : null}
      </p>
    </section>
  );
}
