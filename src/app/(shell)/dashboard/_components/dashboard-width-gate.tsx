"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ROUTE_WINDOW_SIZE } from "@/components/workspace/window-geometry";
import s from "./dashboard-width-gate.module.css";

const MIN_WIDTH = ROUTE_WINDOW_SIZE.dashboard.w;

/** 창 폭과 별개로 실제 대시보드 영역을 잰다. 좁은 데스크톱도 차단하고 모바일·터치는 허용한다. */
export function DashboardWidthGate({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const desktop = window.matchMedia("screen and (pointer: fine)");
    const update = () => {
      setBlocked(desktop.matches && element.getBoundingClientRect().width < MIN_WIDTH);
    };
    // 첫 페인트는 CSS가 차단한다. 이후 본문을 내려 포털로 열린 상세 팝업도 함께 닫는다.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    desktop.addEventListener("change", update);
    return () => {
      observer.disconnect();
      desktop.removeEventListener("change", update);
    };
  }, []);

  return (
    <div ref={container} className={s.viewport}>
      <div className={s.content}>{blocked ? null : children}</div>
      <div className={s.notice} role="status">
        <h2>대시보드를 보려면 창을 넓혀 주세요</h2>
        <p>대시보드 영역의 최소 너비는 {MIN_WIDTH.toLocaleString("ko-KR")}px입니다.</p>
        <p>창을 넓히면 자동으로 다시 표시됩니다.</p>
      </div>
    </div>
  );
}
