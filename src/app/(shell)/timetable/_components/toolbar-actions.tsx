"use client";

import { useState, useTransition } from "react";
import { FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { TimetableImportDialog } from "./import-dialog";
import { syncSheetsNow } from "@/features/integrations/server/actions";

export function TimetableToolbarActions({ subject }: { subject?: string }) {
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
      <button
        type="button"
        onClick={pushToSheet}
        disabled={syncing}
        title={syncMsg ?? "현재 시간표를 연결된 구글 시트에 반영"}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition disabled:opacity-50"
      >
        {syncing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
        시트
      </button>
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
