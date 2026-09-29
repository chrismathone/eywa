/**
 * 원스크린 뷰 모드 — 서버(page의 searchParam 파싱)와 클라(토글 state)가 **공유하는 단일 소스**.
 *
 * ⚠️ 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트가 `parseView`를 import한다.
 * 클라 모듈의 런타임 값을 서버가 쓰면 타입은 통과하고 런타임에 undefined가 되는 침묵 버그(#81).
 */

export const ONESCREEN_VIEWS = ["card", "grid", "status", "history", "notice"] as const;
export type OneScreenView = (typeof ONESCREEN_VIEWS)[number];

/** ClassNote 기능(모듈)에만 있는 뷰 — 발송 현황·월간 발송·학부모 공지. 모듈이 꺼진 학원엔 이 뷰가 없다(2026-09-30). */
export const CLASSNOTE_ONLY_VIEWS: ReadonlySet<OneScreenView> = new Set<OneScreenView>(["status", "history", "notice"]);

/** URL `?view=` → 뷰. 모르는 값·부재는 기본 "card"(잘못된 쿼리로 화면이 비지 않도록). */
export function parseView(raw: string | undefined): OneScreenView {
  return (ONESCREEN_VIEWS as readonly string[]).includes(raw ?? "") ? (raw as OneScreenView) : "card";
}
