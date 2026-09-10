"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWindowStore } from "./window-store";

/** 딥링크 창의 복원이 끝난 뒤, 마지막 창을 닫거나 최소화하면 대시보드를 보여준다. */
export function useEmptyWorkspaceHome(enabled: boolean, homeHref: string) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let requested = false;
    let ready = useWindowStore.persist.hasHydrated();
    const showHome = () => {
      if (requested || !ready) return;
      const { order, windows } = useWindowStore.getState();
      if (order.some((id) => windows[id] && !windows[id].minimized)) return;
      requested = true;
      router.replace(homeHref, { scroll: false });
    };
    // useDeepLinkWindow 다음에 구독하므로 최초 진입 창을 빈 작업 공간으로 오인하지 않는다.
    const unsubscribe = useWindowStore.subscribe(showHome);
    const unhydrate = useWindowStore.persist.onFinishHydration(() => {
      // 앞선 owner 채택도 store를 갱신한다. 딥링크가 열린 뒤까지 그 중간 상태는 무시한다.
      ready = true;
      showHome();
    });
    showHome();
    return () => { unsubscribe(); unhydrate(); };
  }, [enabled, homeHref, router]);
}
