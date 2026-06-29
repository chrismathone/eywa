"use client";

import { useState, useTransition } from "react";
import { ExternalLink, FileSpreadsheet, Loader2, Sheet } from "lucide-react";
import { TimetableImportDialog } from "./import-dialog";
import { syncSheetsNow } from "@/features/integrations/server/actions";

export function TimetableToolbarActions({
  subject,
  canSync = false,
  sheetUrl = null,
}: {
  subject?: string;
  /** 구글 시트 동기화(=테넌트 전체 수학 시간표 외부 push)는 master 전용 — 비-master는 버튼 숨김. */
  canSync?: boolean;
  /** 연결된 구글 시트 URL(설정돼 있을 때만). 있으면 '시트 열기' 노출. */
  sheetUrl?: string | null;
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

  const btnCls =
    "border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition disabled:opacity-50";
  const hasSheetGroup = canSync || !!sheetUrl;

  return (
    <div className="print:hidden flex items-center gap-1">
      {/* 엑셀 그룹: 내보내기 + 가져오기 (둘 다 엑셀 작업 — 한 묶음으로 묶어 '가져오기'가 시트 import로 오해되지 않게) */}
      <div className="flex items-center gap-1">
        <a href={exportHref} className={btnCls}>
          <FileSpreadsheet className="size-3" />
          엑셀
        </a>
        <TimetableImportDialog />
      </div>

      {/* 구글 시트 그룹: 반영(push) + 열기 — 구분선으로 엑셀 그룹과 분리 */}
      {hasSheetGroup ? (
        <div className="border-line ml-0.5 flex items-center gap-1 border-l pl-2">
          {canSync ? (
            <button
              type="button"
              onClick={pushToSheet}
              disabled={syncing}
              title={syncMsg ?? "수학 시간표 전체를 연결된 구글 시트에 반영(원장 전용)"}
              className={btnCls}
            >
              {syncing ? <Loader2 className="size-3 animate-spin" /> : <Sheet className="size-3" />}
              시트 반영
            </button>
          ) : null}
          {sheetUrl ? (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="연결된 구글 시트를 새 탭에서 엽니다"
              className={btnCls}
            >
              <ExternalLink className="size-3" />
              시트 열기
            </a>
          ) : null}
          {syncMsg ? (
            <span
              className={`whitespace-nowrap text-[10px] ${syncMsg === "시트에 반영됨" ? "text-primary" : "text-chart-4"}`}
            >
              {syncMsg}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
