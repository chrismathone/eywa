// 검색 팰릿 단축키 판정 — 서버/클라 공용 상수·순수 함수(⚠️ "use client" 파일에 두지 말 것, #81).
// 상단 헤더(검색창 상시 노출)를 없애며 도입(2026-07-20 원장): Shift+F(타이핑 보호) + Ctrl/Cmd+K(표준).
// ⚠️ Cmd+F(맥)는 브라우저 페이지 내 찾기와 충돌해 채택하지 않음 — 맥도 Shift+F/Cmd+K.

/** 창(iframe) → 최상위 프레임으로 팰릿 열기를 전달하는 postMessage type(팰릿 open 이벤트명과 동일 문자열). */
export const PALETTE_OPEN_MESSAGE = "eywa:open-command-palette";

/** 팰릿 열기 단축키인가 — Shift+F(편집 중 제외) 또는 Ctrl/Cmd+K(편집 중에도 허용, 표준 관례). */
export function isPaletteHotkey(e: KeyboardEvent): boolean {
  const modK =
    (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k";
  if (modK) return true;
  const shiftF =
    e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "F" || e.key === "f");
  if (!shiftF) return false;
  // 타이핑 보호 — 입력 칸에서 Shift+F는 대문자 F 입력이다.
  const t = e.target;
  const editing =
    t instanceof HTMLElement &&
    !!t.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]');
  return !editing;
}
