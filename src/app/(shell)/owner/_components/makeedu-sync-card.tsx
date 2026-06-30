"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setMakeeduSyncEnabled, triggerMakeeduSyncNow } from "@/features/integrations/server/actions";
import type { MakeeduAutoSyncStatus } from "@/features/integrations/server/makeedu-sync";

/**
 * makeedu 자동 동기화 ON/OFF 카드 (연동 면). 토글은 user_integrations(provider=makeedu).sync_enabled를 바꾸고,
 * GitHub Actions cron(sync-all.cjs)이 매 실행 시작에 이 값을 읽어 off면 스킵한다. master 전용(서버 액션이 게이트).
 */
export function MakeeduSyncCard({ status }: { status: MakeeduAutoSyncStatus }) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [running, startRun] = useTransition();
  const [runMsg, setRunMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle() {
    if (pending) return;
    const next = !enabled;
    setError(null);
    start(async () => {
      const res = await setMakeeduSyncEnabled(next);
      if (res?.error) setError(res.error);
      else setEnabled(next);
    });
  }

  // 지금 즉시 1회 동기화 — GitHub Actions 워크플로를 force=true(토글 무시)로 트리거. 결과는 ~1-2분 뒤 배지 반영.
  function runNow() {
    if (running) return;
    setRunMsg(null);
    startRun(async () => {
      const res = await triggerMakeeduSyncNow();
      if (res?.error) setRunMsg({ ok: false, text: res.error });
      else setRunMsg({ ok: true, text: "동기화를 시작했습니다 — 1~2분 뒤 각 화면 배지에 반영됩니다." });
    });
  }

  return (
    <section className="bg-card border-border space-y-4 rounded-md border p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-foreground text-base font-semibold">makeedu 자동 동기화</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            켜면 <strong>하루 2회</strong> makeedu에서 학생·예비상담·수납·반을 자동으로 가져옵니다
            (기존 데이터는 보존하고 새 항목만 추가). 끄면 자동 동기화를 멈춥니다.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="makeedu 자동 동기화"
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

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={runNow} disabled={running}>
          {running ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          지금 동기화
        </Button>
        {runMsg ? (
          <span className={`text-xs ${runMsg.ok ? "text-primary" : "text-chart-4"}`}>{runMsg.text}</span>
        ) : null}
      </div>

      <p className="text-muted-foreground border-t pt-3 text-[11px]">
        반영 시각은 각 화면(학생·수업·상담·수납)의 ‘↻ 동기화’ 배지에 표시됩니다.
        {status.lastSyncedAt
          ? ` · 마지막 동기화 ${new Date(status.lastSyncedAt).toLocaleString("ko-KR")}`
          : null}
      </p>
    </section>
  );
}
