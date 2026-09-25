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

/** 창 → 부모: 미저장 변경 여부. 받는 쪽 = workspace-canvas(닫기 확인 · 표식 주인 기록). */
export const WINDOW_DIRTY_MESSAGE = "eywa-window-dirty";

export type WindowDirtyMessage = { type: typeof WINDOW_DIRTY_MESSAGE; dirty: boolean; doc?: number };

/**
 * 창 문서가 부모에게 보낼 미저장 메시지 — **보낸 문서의 표지(`performance.timeOrigin`)**를 싣는다.
 * 떠나는 문서가 쏘고 곧바로 하드 이동하면 메시지가 **새 문서가 붙은 뒤** 도착할 수 있다 — 부모는 표지가 지금 문서와
 * 다르면 버린다(안 버리면 새 문서가 거짓 '미저장' 주인이 되어 그 문서가 사는 내내 닫기 확인이 뜬다 — 리뷰 2026-09-25).
 */
export function windowDirtyMessage(dirty: boolean): WindowDirtyMessage {
  return { type: WINDOW_DIRTY_MESSAGE, dirty, doc: performance.timeOrigin };
}

/** 부모 쪽 판정 — 메시지가 지금 창에 붙은 문서에서 왔나. 표지가 없으면(옛 배포본 문서) 종전대로 받는다. */
export function isFromCurrentDocument(frameWindow: Window | null | undefined, doc: unknown): boolean {
  if (typeof doc !== "number") return true;
  try {
    return frameWindow?.performance.timeOrigin === doc;
  } catch {
    return true;
  }
}
