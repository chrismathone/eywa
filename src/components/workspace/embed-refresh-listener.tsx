"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { WINDOW_REFRESH_MESSAGE } from "./window-bridge";

/**
 * 창(iframe) 안에서 부모의 소프트 새로고침 명령을 받는다 — 숨어 있던 동안 다른 곳에서 데이터가 바뀐 창이 **다시 보일 때**
 * 부모가 보낸다(use-window-signals.ts). `router.refresh()`라 문서·JS를 다시 올리지 않고 서버 컴포넌트만 다시 받는다.
 * **부모(window.parent)가 보낸 것만** 받는다 — 같은 창 안의 다른 코드나 다른 프레임이 쏜 건 무시.
 */
export function EmbedRefreshListener() {
  const router = useRouter();
  useEffect(() => {
    if (window.parent === window) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const data = e.data as { type?: string } | null;
      if (data?.type !== WINDOW_REFRESH_MESSAGE) return;
      startTransition(() => router.refresh());
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);
  return null;
}
