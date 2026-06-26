"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { windowIdForHref } from "./window-link";
import { publishWindowBusy } from "@/lib/realtime/window-busy";

/**
 * 녹음 등 "끊기면 데이터 유실" 작업이 진행 중인 동안 이 폼이 든 플로팅 창을 잠근다.
 * - 부모 FloatingWindow가 X(닫기)·배경보내기를 비활성화하도록 자기 창 id로 busy 신호 발행.
 * - iframe 자체 새로고침/이탈도 beforeunload로 막음(부모 탭 새로고침은 WorkspaceCanvas가 담당).
 *
 * 창 id는 현재 경로에서 도출한다(`/meetings/new` → `route:meetings/new`) — 폼이 열린 라우트 창의
 * store id와 일치(open()이 windowIdForHref로 만든 그 id). 풀페이지(창 아님)면 발행만 무시될 뿐 무해.
 */
export function useRecordingLock(active: boolean): void {
  const pathname = usePathname();

  useEffect(() => {
    const resolved = windowIdForHref(pathname);
    const winId = resolved ? `route:${resolved.id}` : null;

    if (winId) publishWindowBusy(winId, active);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    if (active) window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      // 언마운트(창 닫힘 등) 시 잠금 확실히 해제 — 부모가 다음 창을 못 잠그는 잔존 방지.
      if (active && winId) publishWindowBusy(winId, false);
    };
  }, [active, pathname]);
}
