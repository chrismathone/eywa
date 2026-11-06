"use client";

import { useEffect } from "react";
import { ASSISTANT_TOGGLE_MESSAGE, isAssistantHotkey } from "./assistant-hotkey";

/**
 * 창(iframe) 안 단축키 → 최상위 문서 학원 비서 토글. keydown은 프레임 경계를 넘지 않으므로 창 문서가 Ctrl/⌘+J를 잡아
 * same-origin postMessage로 부모(`AssistantLauncher`가 듣는다)에 넘긴다. 최상위 문서에선 아무것도 안 한다(런처가 직접 듣는다 — 두 번 토글 방지).
 * 셸 레이아웃의 창(embed) 분기에 `PaletteHotkeyForward` 옆으로 한 번 둔다. 그리는 것 없음.
 */
export function AssistantHotkeyForward() {
  useEffect(() => {
    if (window.self === window.top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !isAssistantHotkey(e)) return;
      e.preventDefault();
      window.parent.postMessage({ type: ASSISTANT_TOGGLE_MESSAGE }, window.location.origin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
