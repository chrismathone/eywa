"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";
import { useMenuHub } from "./menu-hub-store";
import { useShellHome } from "./shell-home";
import { useKeepaliveMode } from "./shell-mode";

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
  // 이전 화면 유지 방식은 바탕(<main>)이 늘 첫 화면이고 주소는 `useKeepaliveFollow`가 맞춘다 — 라우터 이동을 또 하면 기록이 두 칸 쌓인다.
  const keepalive = useKeepaliveMode(); // 폭까지 본다 — 폰·좁은 폭에선 종전대로 라우터 이동

  return useCallback(() => {
    useMenuHub.getState().close();
    showDesktop();
    if (!keepalive && pathname !== home) router.push(home);
  }, [home, keepalive, pathname, router, showDesktop]);
}
