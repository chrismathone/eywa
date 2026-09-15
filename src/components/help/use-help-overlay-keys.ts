"use client";

import { useEffect } from "react";
import { cycleHelpKey, helpKeyForDigit } from "@/features/help/overlay-focus";

type Pill = { key: string; n: number };

export function useHelpOverlayKeys({
  open,
  pills,
  focusKey,
  onFocus,
  onClose,
}: {
  open: boolean;
  pills: readonly Pill[];
  focusKey: string | null;
  onFocus: (key: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const keys = pills.map((p) => p.key);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        if (keys.length === 0) return;
        const cur = focusKey && keys.includes(focusKey) ? focusKey : keys[0]!;
        onFocus(cycleHelpKey(keys, cur, e.shiftKey ? -1 : 1));
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (keys.length === 0) return;
        const cur = focusKey && keys.includes(focusKey) ? focusKey : keys[0]!;
        onFocus(cycleHelpKey(keys, cur, -1));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (keys.length === 0) return;
        const cur = focusKey && keys.includes(focusKey) ? focusKey : keys[0]!;
        onFocus(cycleHelpKey(keys, cur, 1));
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const hit = helpKeyForDigit(pills, Number(e.key));
        if (hit) onFocus(hit);
        return;
      }
      if ((e.key === "Enter" || e.key === " ") && e.target instanceof HTMLElement && e.target.dataset.helpPill) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pills, focusKey, onFocus, onClose]);

  useEffect(() => {
    if (!open || !focusKey) return;
    const el = document.querySelector<HTMLElement>(`[data-help-pill="${CSS.escape(focusKey)}"]`);
    el?.focus({ preventScroll: true });
  }, [open, focusKey]);
}
