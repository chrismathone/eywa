"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { useInFrame } from "./use-in-frame";
import { windowIdForHref } from "./window-link";
import { WINDOW_CHROME, windowMinSize } from "./window-geometry";

/**
 * 창 **최소 크기 위반** 안내 — 창(iframe) 본문이 그 메뉴의 최소 크기(`ROUTE_WINDOW_SIZE`)보다 작을 때 맨 위에 띄운다.
 *
 * 원장 2026-09-03: *"창이 줄어들어도 기존 4열 스타일을 유지하는 게 오히려 가독성이 뛰어남 · 차라리 '최소 크기 위반'
 * 경고 안내 페이지를 띄우거나 창 크기를 최소 크기보다 줄이려고 할 때 경고를 띄우고 줄어들지 않도록"*.
 *
 * 두 겹이다: ① 리사이즈 드래그는 [`resizeRect`](./window-geometry.ts)가 그 창의 최소 크기에서 **멈춘다**(손잡이 옆 힌트).
 * ② 그래도 작아질 수 있는 길(스냅·타일·작은 모니터·복원)에서는 화면을 접지 않고 **이 안내**가 선다 — 레이아웃은
 * 최소 폭 그대로라 가로로 밀어 볼 수 있고, [창 최대화]가 부모 캔버스에 postMessage한다.
 *
 * 🔴 판정은 물리 프레임(`useInFrame`)이다 — 최상위 프레임(폰·직접 방문)엔 키울 창이 없어 안 띄운다.
 * ⚠️ 크기는 `useSyncExternalStore`로 읽는다(effect 안 setState 금지, [[#25]]) — SSR 스냅샷은 빈 문자열이라 서버에선 안 그린다.
 */
function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const getSize = () => `${window.innerWidth}x${window.innerHeight}`;
const getServerSize = () => "";

export function WindowMinSizeNotice() {
  const inFrame = useInFrame();
  const pathname = usePathname();
  const size = useSyncExternalStore(subscribe, getSize, getServerSize);
  if (!inFrame || !size) return null;
  const win = windowIdForHref(pathname);
  if (!win) return null;
  const min = windowMinSize(win.id);
  const [w, h] = size.split("x").map(Number);
  // 창 rect의 최소 크기에서 크롬(타이틀바·테두리)을 뺀 것이 본문 iframe의 최소 크기다. 1px은 반올림 오차라 위반이 아니다.
  const tooNarrow = w < min.w - WINDOW_CHROME.w - 1;
  const tooShort = h < min.h - WINDOW_CHROME.h - 1;
  if (!tooNarrow && !tooShort) return null;
  const maximize = () => {
    try {
      window.parent.postMessage({ type: "eywa-window-maximize" }, window.location.origin);
    } catch {
      /* 부모가 없거나 막혀 있으면 조용히 — 안내는 그대로 남는다. */
    }
  };
  return (
    <div
      role="status"
      className="border-amber/40 bg-amber-soft text-amber mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border px-3 py-1.5 text-sm font-bold"
    >
      <span>
        이 창의 최소 크기는 <span className="num">{min.w}×{min.h}</span> — 지금{" "}
        <span className="num">
          {w}×{h}
        </span>
        . 창을 키워 주세요.
      </span>
      <button
        type="button"
        onClick={maximize}
        className="text-amber shrink-0 rounded-md border border-current px-2 py-0.5 font-bold hover:bg-background/40"
      >
        창 최대화
      </button>
    </div>
  );
}
