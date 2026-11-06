/**
 * 학원 비서 단축키·열기 신호 — 서버/클라 공용 순수 모듈(⚠️ "use client" 파일에 두지 말 것, #81).
 *
 * 단축키 = **Ctrl+J / ⌘J**(열기·닫기 토글). 이미 쓰는 것과 겹치지 않는다 —
 * Ctrl·⌘+K·Shift+F = 검색 팰릿(`palette-hotkey.ts`) · F1 = 화면 도움말 · Ctrl·⌘+B = 사이드바(ui/sidebar) · Ctrl·⌘+Z/Y = 운영실 편집 ·
 * F2 = 영어 이름 편집 · Alt+Enter = 시간표 메모. AI 도우미에 흔히 쓰는 자리(⌘J)라 낯설지 않고, 입력 중에도 눌러 닫을 수 있다.
 * - 한글 입력 상태에서는 `e.key`가 `ㅓ`로 온다 → **`e.code === "KeyJ"`**(자판 위치)로 본다.
 * - Shift·Alt가 섞이면 아니다 — Ctrl+Shift+J는 브라우저 개발자 도구다.
 * - 크롬·엣지의 Ctrl+J(다운로드 목록)는 예약 단축키가 아니어서 페이지가 먼저 받아 막을 수 있다.
 * 창(iframe) 안의 keydown은 프레임을 못 넘는다 — 창 문서는 `AssistantHotkeyForward`가 postMessage로 넘긴다(팰릿과 같은 길).
 */

/** 창(iframe) → 최상위 문서: 비서 열기·닫기 토글(postMessage type). */
export const ASSISTANT_TOGGLE_MESSAGE = "eywa:toggle-assistant";
/** 같은 문서 안 어디서든 비서를 **연다**(`window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT))` — 사이드바·모바일 메뉴 버튼). */
export const ASSISTANT_OPEN_EVENT = "eywa:open-assistant";

/** 같은 문서의 런처를 연다 — 사이드바·모바일 메뉴 같은 다른 자리의 버튼이 부른다(런처는 레이아웃에 하나만 둔다). */
export function openAssistant(): void {
  window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT));
}

type KeyLike = Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key" | "code">;

/** 비서 토글 단축키인가 — Ctrl/⌘+J(입력 중에도). */
export function isAssistantHotkey(e: KeyLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return false;
  return e.code === "KeyJ" || (typeof e.key === "string" && e.key.toLowerCase() === "j");
}

/** 화면에 적는 단축키 글자 — 맥은 `⌘J`, 그 밖은 `Ctrl+J`. */
export function assistantHotkeyLabel(platform: string | undefined): string {
  return platform && /mac|iphone|ipad|ipod/i.test(platform) ? "⌘J" : "Ctrl+J";
}
