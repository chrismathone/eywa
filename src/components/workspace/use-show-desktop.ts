"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";

/**
 * 배경(메뉴 화면)을 전면에 보인다 — 열린 창은 내리고(showDesktop) 배경 라우트가 `/menu`가 아니면 이동한다.
 * ⚠️ 2026-09-07부터 배경은 **운영실이 아니라 메뉴**다(운영실은 다른 메뉴처럼 창으로 열린다).
 */
export function useShowDesktop() {
  const pathname = usePathname();
  const router = useRouter();
  const showDesktop = useWindowStore((s) => s.showDesktop);

  return useCallback(() => {
    showDesktop();
    if (pathname !== "/menu") router.push("/menu");
  }, [pathname, router, showDesktop]);
}
