"use client";

import { useEffect } from "react";
import { isPaletteHotkey, PALETTE_OPEN_MESSAGE } from "@/lib/palette-hotkey";

/**
 * 창(iframe) 안 단축키 → 최상위 프레임 검색 팰릿 열기 포워더.
 * keydown은 프레임 경계를 넘지 않으므로, 임베드 문서가 Shift+F/Ctrl·Cmd+K를 잡아
 * same-origin postMessage로 부모(CommandPalette 청취)에 전달한다. 최상위 프레임에선 no-op
 * (팰릿이 직접 keydown을 듣는다 — 이중 발화 방지).
 */
export function PaletteHotkeyForward() {
  useEffect(() => {
    if (window.self === window.top) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteHotkey(e)) return;
      e.preventDefault();
      window.parent.postMessage({ type: PALETTE_OPEN_MESSAGE }, window.location.origin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
