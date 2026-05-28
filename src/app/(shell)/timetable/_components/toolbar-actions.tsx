"use client";

import { useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";

export function TimetableToolbarActions() {
  const [exporting, setExporting] = useState(false);

  async function exportPng() {
    setExporting(true);
    try {
      const target = document.getElementById("timetable-export-root");
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
