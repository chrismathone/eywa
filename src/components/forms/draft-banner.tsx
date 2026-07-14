"use client";

import { History } from "@/components/icons/eywa-icon-compat";

/**
 * 로컬 초안 복구 배너 — useFormDraft의 draftSavedAt/restore/discard를 받아 폼 최상단에 렌더.
 * 입력 중 자동저장된 내용이 있을 때만 표시(savedAt 있을 때). 녹음 복구 배너와 동일 톤.
 */
export function DraftBanner({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: number | null;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  if (!savedAt) return null;
  return (
    <div className="border-chart-3/40 bg-chart-3/5 flex items-start gap-3 rounded-md border px-4 py-3">
      <History className="text-chart-3 mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-foreground text-sm font-medium">작성하던 내용이 있습니다</p>
        <p className="text-text-dim text-xs">
          {new Date(savedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}에 자동 저장됨 — 이어서 작성하거나 새로 시작할 수 있습니다.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onRestore} className="text-foreground hover:text-chart-3 text-xs font-medium">
            이어서 작성
          </button>
          <span className="text-text-faint text-xs">·</span>
          <button type="button" onClick={onDiscard} className="text-text-dim hover:text-foreground text-xs">
            새로 시작
          </button>
        </div>
      </div>
    </div>
  );
}
