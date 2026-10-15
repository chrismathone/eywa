"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { FILTER_SEEN_TOUCH_MS, filterScreenOf } from "@/lib/filter-reset/rules";
import { touchFilterSeen } from "@/lib/filter-reset/client";
import { useWorkspaceEnabled } from "@/components/workspace/workspace-enabled";
import { isDesktopNow, useIsDesktop } from "@/components/workspace/use-is-desktop";

/**
 * 필터를 계정에 저장하는 화면을 **언제 마지막으로 봤나**를 적는다 — 필터 10분 초기화(규칙 `src/lib/filter-reset/rules.ts`)의 기록기.
 * 보이게 된 순간 · 보이는 동안 30초마다 · 가려지는 순간(창이 숨음·탭이 가려짐) · 보이던 채로 떠날 때(다른 화면으로 이동·문서 닫힘) 적는다.
 * 🔴 **가려져 있는 동안은 적지 않는다** — 최소화한 창에도 탭 전환·화면 잠금의 `visibilitychange`가 오고, 숨은 채 닫히는 창·지워지는
 *    유지 화면에도 떠나는 신호가 온다. 그때 적으면 아무도 안 본 화면이 '방금 본' 것이 된다(적대 재리뷰 2026-10-15). 보임 상태가
 *    실제로 바뀔 때만 적는다.
 *
 * 셸 레이아웃이 화면을 그리는 문서마다 하나 둔다 — 창(iframe) 문서 · 단일 화면 · 강사 미니셸 · 모바일.
 * 🔴 창 엔진을 쓰는 데스크톱(창 모드·이전 화면 유지)의 **바깥 문서**에선 쉰다 — 그 문서의 화면은 운영실 말고는 늘 캔버스에 덮여 있고
 *    (deep-link-window.ts), 화면을 그리는 건 창 문서다. 바깥 문서가 적으면 아무도 안 보는 화면이 영원히 '본 것'이 된다.
 *    데스크톱 판정은 **효과 안에서** 직접 묻는다(훅은 하이드레이션 첫 렌더에 서버 값 '데스크톱 아님'을 준다) — 훅 값은 창 폭이 바뀌면
 *    다시 판정하도록 의존값으로만 쓴다.
 * 창 문서의 '보임'은 부모가 덮어 주는 `visibilityState`다(frame-visibility.ts — 숨은 창도 탭 기준으론 visible이라).
 */
export function FilterSeenTracker() {
  const pathname = usePathname();
  const workspace = useWorkspaceEnabled();
  const desktop = useIsDesktop();
  const key = filterScreenOf(pathname)?.key ?? null;
  useEffect(() => {
    if (!key) return;
    if (workspace && window.self === window.top && isDesktopNow()) return;
    const visible = () => document.visibilityState === "visible";
    let shown = visible();
    if (shown) touchFilterSeen(key);
    const timer = window.setInterval(() => {
      if (visible()) touchFilterSeen(key);
    }, FILTER_SEEN_TOUCH_MS);
    const onVisibility = () => {
      const now = visible();
      if (now === shown) return;
      shown = now;
      // 보이게 된 순간 · 보이다가 가려지는 순간(마지막으로 본 시각)
      touchFilterSeen(key);
    };
    const onPageHide = () => {
      if (shown) touchFilterSeen(key);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // 보이던 채로 다른 화면으로 떠나는 순간
      if (shown) touchFilterSeen(key);
    };
  }, [key, workspace, desktop]);
  return null;
}
