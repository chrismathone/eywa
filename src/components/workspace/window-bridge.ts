/**
 * 부모(창 틀) → 창(iframe) 명령 — 같은 origin postMessage. 창 → 부모 방향(focus·dirty·busy·open-window 등)은
 * workspace-canvas·route-window가 받는 기존 메시지들이다.
 * ⚠️ 일반 모듈이다(`"use client"` 아님) — 상수를 양쪽이 import한다([[#81]]).
 */

/** 창 안 서버 컴포넌트만 다시 받는다(`router.refresh()` — 클라 상태·스크롤·입력은 그대로). */
export const WINDOW_REFRESH_MESSAGE = "eywa-window-refresh";

export type WindowRefreshMessage = { type: typeof WINDOW_REFRESH_MESSAGE };

/** 부모가 창에게 소프트 새로고침을 시킨다. 창이 아직 라우트를 싣기 전이거나 접근 불가면 false. */
export function postWindowRefresh(frame: HTMLIFrameElement | null): boolean {
  try {
    const cw = frame?.contentWindow;
    if (!cw || cw.location.href === "about:blank") return false;
    const msg: WindowRefreshMessage = { type: WINDOW_REFRESH_MESSAGE };
    cw.postMessage(msg, window.location.origin);
    return true;
  } catch {
    return false;
  }
}
