"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { windowIdForHref } from "./window-link";
import { publishWindowBusy } from "@/lib/realtime/window-busy";

/** 창 본문(iframe) → 부모 잠금 신호의 메시지 종류 — RouteWindow가 **자기 iframe이 보낸 것만** 받는다. */
export const WINDOW_BUSY_MESSAGE = "eywa-window-busy";

/**
 * 녹음 등 "끊기면 데이터 유실" 작업이 진행 중인 동안 이 폼이 든 플로팅 창을 잠근다.
 * - 부모 FloatingWindow가 X(닫기)·배경보내기를 비활성화하고, 창 개수 한도의 축출도 이 창을 건너뛴다.
 * - iframe 자체 새로고침/이탈도 beforeunload로 막음(부모 탭 새로고침은 WorkspaceCanvas가 담당).
 *
 * 신호는 두 갈래다.
 * - **부모에게 직접(postMessage)** — 창 id는 부모(RouteWindow)가 `event.source`로 정한다. 🔴 경로로 추측하지 않는다
 *   ([[#69]] ①): 상세 창(`route:enrollment/abc`) 안에서 수정으로 들어가면 경로는 `/enrollment/abc/edit`인데, 경로로 만든
 *   id(`route:enrollment/abc/edit`)는 **없는 창**이라 녹음 중인 진짜 창이 닫기·축출에 그대로 노출됐다(전수검사 2026-09-11).
 *   창(iframe)이 아니면(전체화면·미니셸) window.parent===window라 보내지 않는다(무해).
 * - **방송(BroadcastChannel)** — WorkspaceCanvas가 탭 전체 새로고침을 막는 데 쓴다. 이쪽 id는 경로에서 도출한다
 *   (`/meetings/new` → `route:meetings/new`, 풀페이지면 발행만 무시될 뿐 무해).
 */
export function useRecordingLock(active: boolean): void {
  const pathname = usePathname();

  useEffect(() => {
    const resolved = windowIdForHref(pathname);
    const winId = resolved ? `route:${resolved.id}` : null;
    const inFrame = window.parent !== window;

    const signal = (on: boolean) => {
      if (winId) publishWindowBusy(winId, on);
      if (!inFrame) return;
      try {
        window.parent.postMessage({ type: WINDOW_BUSY_MESSAGE, active: on }, window.location.origin);
      } catch {
        /* cross-origin 등 — 무시 */
      }
    };
    signal(active);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // 문서가 통째로 내려가면(창 ←·메뉴 '첫 화면으로'에서 떠나기를 확인) 언마운트 정리가 안 돈다 — 그대로 두면 잠금이
    // 남아 그 창의 닫기가 영영 막힌다(해제 신호를 보낼 문서가 이미 없다). 내려가는 순간 푼다.
    const onPageHide = () => signal(false);
    if (active) {
      window.addEventListener("beforeunload", onBeforeUnload);
      window.addEventListener("pagehide", onPageHide);
    }

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      // 언마운트(창 닫힘 등) 시 잠금 확실히 해제 — 부모가 다음 창을 못 잠그는 잔존 방지.
      if (active) signal(false);
    };
  }, [active, pathname]);
}
