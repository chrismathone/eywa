"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  PAGE_MAXIMIZE_QUERY_MESSAGE,
  PAGE_MAXIMIZE_SET_MESSAGE,
  PAGE_MAXIMIZE_STATE_MESSAGE,
} from "@/components/workspace/keepalive-frame";
import { iframeRegistry } from "@/components/workspace/route-window";
import { PageMaximizeContext, usePageMaximize } from "./page-maximize-context";

/**
 * 이전 화면 유지 화면(iframe 문서)의 '화면 최대화' — **상태는 부모 셸이 갖는다**(사이드바가 부모 문서에 있고, 계정 저장도 거기서 한다).
 * 이 문서는 ① 눌림을 부모에 알리고(`set`) ② 부모가 알려 주는 지금 상태를 받아(`state`) ③ 자기 문서의 표식 `data-page-maximize`를 단다 —
 * 머리글·여백을 숨기는 CSS(`globals.css`)가 이 표식을 읽는다. 부모는 화면이 열릴 때 `query`로 지금 상태를 묻는 이 문서에 답한다
 * (부모 쪽 짝 = 아래 `KeepaliveMaximizeSync`).
 * 🔴 같은 출처·부모 창에서 온 메시지만 받는다(다른 창의 위조 신호 차단).
 */
export function KeepalivePageMaximize({ initial, children }: { initial: boolean; children: ReactNode }) {
  const [maximized, setState] = useState(initial);

  useEffect(() => {
    if (window.parent === window) return;
    const origin = window.location.origin;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; on?: boolean } | null;
      if (d?.type === PAGE_MAXIMIZE_STATE_MESSAGE) setState(d.on === true);
    };
    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage({ type: PAGE_MAXIMIZE_QUERY_MESSAGE }, origin);
    } catch {
      /* 무시 */
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const setMaximized = useCallback((on: boolean) => {
    setState(on); // 바로 보이게(부모 확정은 곧 같은 값으로 온다)
    try {
      window.parent.postMessage({ type: PAGE_MAXIMIZE_SET_MESSAGE, on }, window.location.origin);
    } catch {
      /* 무시 */
    }
  }, []);

  const value = useMemo(() => ({ maximized, setMaximized }), [maximized, setMaximized]);
  return (
    <PageMaximizeContext.Provider value={value}>
      {/* display:contents — 상자를 만들지 않는다. 표식만 단다(부모 PageMaximizeRoot와 같은 방식). */}
      <div data-page-maximize={maximized ? "on" : "off"} className="contents">
        {children}
      </div>
    </PageMaximizeContext.Provider>
  );
}

/**
 * 부모 셸 쪽 짝 — 이전 화면 유지 무대(`KeepaliveStage`)가 그린다(그 방식에서만 산다). 셸의 '화면 최대화' 상태(`PageMaximizeRoot`)를
 * 열린 화면(iframe) 전부에 알리고, 화면이 누른 것(`set` → 부모가 저장)·묻는 것(`query`)에 답한다. 아무것도 그리지 않는다.
 * 🔴 우리 창(iframe)에서 온 것만 받는다 — 같은 출처 + 레지스트리의 contentWindow와 대조(워크스페이스 캔버스와 같은 방식).
 * 공급자가 없으면(창 모드 — 최대화가 없다) 아무것도 하지 않는다.
 */
export function KeepaliveMaximizeSync() {
  const ctx = usePageMaximize();
  const on = ctx?.maximized ?? false;
  const setMaximized = ctx?.setMaximized;
  useEffect(() => {
    if (!setMaximized) return;
    const origin = window.location.origin;
    const tell = (target: Window | null | undefined) => {
      try {
        target?.postMessage({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on }, origin);
      } catch {
        /* 무시 */
      }
    };
    for (const el of iframeRegistry.values()) tell(el.contentWindow);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || !e.source) return;
      let known = false;
      for (const el of iframeRegistry.values()) if (el.contentWindow === e.source) known = true;
      if (!known) return;
      const d = e.data as { type?: string; on?: boolean } | null;
      if (d?.type === PAGE_MAXIMIZE_SET_MESSAGE) setMaximized(d.on === true);
      else if (d?.type === PAGE_MAXIMIZE_QUERY_MESSAGE) tell(e.source as Window);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [on, setMaximized]);
  return null;
}
