"use client";

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";
import { useMenuHub } from "./menu-hub-store";

/**
 * 대시보드를 전면에 보인다. 작업 중인 창과 입력 내용은 최소화한 상태로 보존한다.
 */
export function useShowDesktop() {
  const pathname = usePathname();
  const router = useRouter();
  const showDesktop = useWindowStore((s) => s.showDesktop);

  return useCallback(() => {
    useMenuHub.getState().close();
    showDesktop();
    if (pathname !== "/dashboard") router.push("/dashboard");
  }, [pathname, router, showDesktop]);
}
