"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useWindowStore } from "@/components/workspace/window-store";

const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const CHECKED_AT_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** KST 다음 자정까지 남은 밀리초. 자정 정각이면 다음 날 자정까지를 반환한다. */
export function millisecondsUntilNextKstMidnight(nowMs: number): number {
  const elapsedSinceKstMidnight = (nowMs + KST_OFFSET_MS) % DAY_MS;
  return elapsedSinceKstMidnight === 0 ? DAY_MS : DAY_MS - elapsedSinceKstMidnight;
}

/**
 * 서버 브리핑은 그대로 두고 재조회 트리거만 담당하는 작은 클라이언트 경계.
 * 새로고침 뒤 RSC payload가 병합되므로 스크롤과 주변 클라이언트 상태는 유지된다.
 */
export function BriefingAutoRefresh({ checkedAt }: { checkedAt: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const hasOpenWindow = useWindowStore((state) =>
    state.order.some((id) => state.windows[id] && !state.windows[id].minimized),
  );
  const wasCovered = useRef(hasOpenWindow);

  useEffect(() => {
    let midnightTimer = 0;
    let wasHidden = document.visibilityState === "hidden";
    let lastRefreshAt = 0;

    const refresh = () => {
      const now = Date.now();
      if (now - lastRefreshAt < 1_000) return;
      lastRefreshAt = now;
      startTransition(() => router.refresh());
    };
    if (hasOpenWindow) {
      wasCovered.current = true;
      return;
    }
    if (wasCovered.current) {
      wasCovered.current = false;
      refresh();
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const scheduleMidnightRefresh = () => {
      midnightTimer = window.setTimeout(() => {
        refreshIfVisible();
        scheduleMidnightRefresh();
      }, millisecondsUntilNextKstMidnight(Date.now()));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        refresh();
      }
    };

    const interval = window.setInterval(refreshIfVisible, FIVE_MINUTES_MS);
    scheduleMidnightRefresh();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(midnightTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [hasOpenWindow, router, startTransition]);

  return (
    <span className="relative inline-flex flex-wrap items-center gap-x-1.5" aria-live="polite" aria-atomic="true">
      <time dateTime={checkedAt}>마지막 확인 {CHECKED_AT_FORMATTER.format(new Date(checkedAt))}</time>
      <span aria-hidden="true">·</span>
      <span>운영실을 보는 동안 5분마다 갱신</span>
      {/* relative 필수 — sr-only는 absolute라 positioned 부모가 없으면 main의 클리핑을 뚫고 문서를 늘린다(gotchas #79). */}
      <span className="sr-only">KST 날짜가 바뀌거나 화면으로 돌아올 때도 다시 확인합니다.</span>
    </span>
  );
}
