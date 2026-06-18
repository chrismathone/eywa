"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { TimetableImportDialog } from "./import-dialog";

export function TimetableToolbarActions() {
  const [exporting, setExporting] = useState(false);

  async function exportPng() {
    setExporting(true);
    try {
      // 캡처 대상은 전체 크기의 표(스크롤 콘텐츠) — 보드는 높이 제한된 스크롤 뷰포트라
      // 컨테이너를 캡처하면 보이는 만큼만 잘린다. 표를 직접 잡아 전 행·열을 담는다.
      const target = document.querySelector<HTMLTableElement>("#timetable-export-root table");
      if (!target) {
        setExporting(false);
        return;
      }
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(target, {
        backgroundColor: "#fbf9f3",
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `시간표_${dateStr}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (e) {
      console.error("PNG export failed", e);
    } finally {
      setExporting(false);
    }
  }

  function printPage() {
    window.print();
  }

  return (
    <div className="print:hidden flex items-center gap-1">
      <a
        href="/api/exports/timetable"
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <FileSpreadsheet className="size-3" />
        엑셀
      </a>
      <TimetableImportDialog />
      <button
        type="button"
        onClick={exportPng}
        disabled={exporting}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition disabled:opacity-50"
      >
        {exporting ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Download className="size-3" />
        )}
        PNG
      </button>
      <button
        type="button"
        onClick={printPage}
        className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition"
      >
        <Printer className="size-3" />
        인쇄
      </button>
    </div>
  );
}
