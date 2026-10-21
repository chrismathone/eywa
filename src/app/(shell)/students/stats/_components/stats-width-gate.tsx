"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { WINDOW_CHROME, windowMinSize } from "@/components/workspace/window-geometry";

const minWidth = windowMinSize("students", "/students/stats").w;
const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const getWidth = () => window.innerWidth;
const serverWidth = () => 0;

/** 통계는 좁은 화면에 억지로 접지 않는다(원장 2026-10-21). 세로는 스크롤, 가로는 창 최소 크기와 같은 기준. */
export function StatsWidthGate({ children }: { children: ReactNode }) {
  const width = useSyncExternalStore(subscribe, getWidth, serverWidth);
  const inFrame = useInFrame();
  if (!width) return <div aria-busy="true" aria-label="화면 크기 확인 중" className="bg-bg-soft h-96 animate-pulse rounded-2xl" />;
  if (width + (inFrame ? WINDOW_CHROME.w : 0) >= minWidth) return children;
  return (
    <div role="status" className="border-line space-y-3 rounded-2xl border p-6">
      <h2 className="text-lg font-bold">통계는 넓은 화면에서 확인해 주세요</h2>
      <p className="text-sm break-keep">추이와 집계 기준을 함께 읽으려면 가로 {minWidth.toLocaleString("ko-KR")}px 이상이 필요합니다. 창을 넓히거나 더 큰 화면에서 열어 주세요.</p>
      {inFrame ? <Button onClick={() => window.parent.postMessage({ type: "eywa-window-maximize" }, window.location.origin)}>창 최대화</Button> : null}
    </div>
  );
}
