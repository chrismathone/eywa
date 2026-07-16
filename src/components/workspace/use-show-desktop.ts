"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";

/**
 * 데스크톱 작업면(`/dashboard`)을 전면에 보인다.
 * 창 상태 정리를 먼저 적용하고, 다른 라우트에서 진입한 경우에만 App Router로 이동한다.
 */
export function useShowDesktop() {
  const pathname = usePathname();
  const router = useRouter();
  const showDesktop = useWindowStore((s) => s.showDesktop);

  return useCallback(() => {
    showDesktop();
    if (pathname !== "/dashboard") router.push("/dashboard");
  }, [pathname, router, showDesktop]);
}
