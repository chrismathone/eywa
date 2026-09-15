/** F1 — 브라우저 기본 도움말을 막고 이 화면 겹침을 연다. 입력 중에도 연다(화면 설명을 찾는 자리). */
export function isHelpHotkey(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  return e.key === "F1";
}
