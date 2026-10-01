"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";
import { useMenuHub } from "./menu-hub-store";
import { useShellHome } from "./shell-home";

/**
 * 첫 화면(바탕)을 전면에 보인다. 작업 중인 창과 입력 내용은 최소화한 상태로 보존한다.
 * 바탕 주소는 권한을 본 홈(`/dashboard` | `/menu`) — 대시보드를 꺼 둔 사람을 `/dashboard`로 보내 튕기게 하지
 * 않는다(2026-10-01, gotchas #137).
 */
export function useShowDesktop() {
  const pathname = usePathname();
  const router = useRouter();
  const showDesktop = useWindowStore((s) => s.showDesktop);
  const home = useShellHome();

  return useCallback(() => {
    useMenuHub.getState().close();
    showDesktop();
    if (pathname !== home) router.push(home);
  }, [home, pathname, router, showDesktop]);
}
