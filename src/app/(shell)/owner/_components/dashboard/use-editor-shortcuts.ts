"use client";

import { useEffect } from "react";

export function useEditorShortcuts(editing: boolean, undo: () => void, redo: () => void) {
  // 되돌리기·다시 하기 단축키 — 편집 중이고 글자 칸에 있지 않을 때만.
  useEffect(() => {
    if (!editing) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) {
        ev.preventDefault();
        undo();
      } else if ((k === "z" && ev.shiftKey) || k === "y") {
        ev.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, undo, redo]);

}
