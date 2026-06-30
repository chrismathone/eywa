"use client";

import { useEffect } from "react";

/**
 * 플로팅 창 본문(iframe) 아무 곳이나 클릭하면 그 창이 최상단(focus)으로 오게 한다.
 *
 * 배경: 창 본문은 크롬리스 라우트를 담은 same-origin iframe이라 **별도 문서**다. iframe 안에서 발생한
 * pointerdown은 iframe 문서 내부에 갇혀 부모 FloatingWindow의 onPointerDown(=focus 트리거)까지 버블되지
 * 않는다. 그래서 지금까지는 **타이틀바·리사이즈 핸들(부모 DOM)을 눌러야만** 그 창이 최상단으로 왔다.
 *
 * 해결: embed 페이지(=창 본문)에 이 컴포넌트를 1회 마운트해, **capture pointerdown을 관찰만**(입력은
 * 가로채지 않음 — preventDefault/stopPropagation 안 함, passive)하고 `window.parent`로 'focus me'를
 * postMessage한다. 부모 WorkspaceCanvas가 `event.source`(=클릭된 이 iframe의 contentWindow)를
 * iframeRegistry와 대조해 **정확한 창 id**를 찾아 focus한다.
 *
 * postMessage(부모 한정)라 같은 탭의 부모에게만 전달된다 → 다른 탭으로 안 새고, 중복 창도
 * contentWindow로 구분된다(BroadcastChannel의 cross-tab 누수·pathname 기반 중복 모호성 둘 다 회피).
 * ⚠️ client 전용([[#61]]).
 */
export function EmbedFocusSignal() {
  useEffect(() => {
    // 최상위 프레임(창이 아님)이면 무의미 — iframe 안에서만 동작.
    if (typeof window === "undefined" || window.parent === window) return;
    const parent = window.parent;
    const origin = window.location.origin;
    const signal = () => {
      try {
        parent.postMessage({ type: "eywa-window-focus" }, origin);
      } catch {
        /* 제약(cross-origin 등) 시 조용히 무시 */
      }
    };
    // capture+passive = 관찰만. 버튼·링크·입력·드래그 클릭을 전혀 차단하지 않으면서 포커스만 끌어올린다.
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("pointerdown", signal, opts);
    return () => document.removeEventListener("pointerdown", signal, opts);
  }, []);
  return null;
}
