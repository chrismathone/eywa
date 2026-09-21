"use client";

import { useEffect, useRef } from "react";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { STATUS_TONE, statusTextOf } from "@/features/attendance/cell-display";
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { STATUS_OPTIONS, popoverPosition, type PopoverAnchor } from "./cell-popover";

export function RangeStatusPopover({
  count, anchor, onPick, onClose,
}: {
  count: number;
  anchor: PopoverAnchor;
  onPick: (status: AttendanceStatus) => void;
  onClose: () => void;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, []);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} aria-hidden />
      <div
        role="dialog"
        aria-label={tf("att.range.title", { n: count })}
        className="bg-card border-line fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
        style={popoverPosition(anchor)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      >
        <p className="px-2 py-1 text-xs font-semibold">{tf("att.range.title", { n: count })}</p>
        <p className="text-text-dim px-2 pb-1 text-xs leading-tight">{t("att.range.keepUnits")}</p>
        {STATUS_OPTIONS.map((status, i) => (
          <button
            key={status}
            ref={i === 0 ? firstButton : undefined}
            type="button"
            onClick={() => { onPick(status); onClose(); }}
            className="hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition"
          >
            {statusTextOf(status, lang)}
            <span className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[status]}`} aria-hidden />
          </button>
        ))}
      </div>
    </>
  );
}
