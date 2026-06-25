"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { TimetableImportDialog } from "./import-dialog";
import { syncSheetsNow } from "@/features/integrations/server/actions";

export function TimetableToolbarActions({
  subject,
  canSync = false,
}: {
  subject?: string;
  /** 구글 시트 동기화(=테넌트 전체 수학 시간표 외부 push)는 master 전용 — 비-master는 버튼 숨김. */
  canSync?: boolean;
}) {
  const [syncing, startSync] = useTransition();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const exportHref = `/api/exports/timetable?subject=${encodeURIComponent(subject ?? "math")}`;

  function pushToSheet() {
    setSyncMsg(null);
    startSync(async () => {
      const res = await syncSheetsNow(undefined, new FormData());
      if (res?.error) setSyncMsg(res.error);
      else setSyncMsg("시트에 반영됨");
    });
  }

  return (
    <div className="print:hidden flex items-center gap-1">
      <a
        href={exportHref}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <FileSpreadsheet className="size-3" />
        엑셀
      </a>
      <TimetableImportDialog />
      {canSync ? (
        <button
          type="button"
          onClick={pushToSheet}
          disabled={syncing}
          title={syncMsg ?? "수학 시간표 전체를 연결된 구글 시트에 eywa 탭으로 반영(원장 전용)"}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition disabled:opacity-50"
        >
          {syncing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
          시트
        </button>
      ) : null}
      {syncMsg ? (
        <span
          className={`text-[10px] ${syncMsg === "시트에 반영됨" ? "text-primary" : "text-chart-4"}`}
        >
          {syncMsg}
        </span>
      ) : null}
    </div>
  );
}
