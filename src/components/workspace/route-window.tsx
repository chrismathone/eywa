"use client";

import { useState } from "react";
import { useWindowStore, type Win } from "./window-store";

/** href에 embed=1을 안전 병합(기존 쿼리 보존). */
function withEmbed(href: string) {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  return `${path}?${params.toString()}`;
}

/**
 * 메뉴 풀화면 창 — 크롬리스 라우트를 same-origin iframe으로 임베드.
 * 별도 문서/정상 네비게이션이라 "RSC 트리 명령형 마운트"(Next16 부재) 제약을 우회하고,
 * 쿠키가 그대로 실려 RLS가 iframe마다 독립 적용된다. 드래그/리사이즈는 setPointerCapture라
 * iframe이 포인터를 가로채도 정상 동작. onLoad까지 라이트 스켈레톤.
 */
export function RouteWindow({ win }: { win: Win }) {
  const [loaded, setLoaded] = useState(false);
  // 드래그/리사이즈 중에는 iframe을 숨겨 매 프레임 재페인트를 막아 부드럽게 이동.
  const dragging = useWindowStore((s) => s.draggingId === win.id);
  const href = win.params.href;
  if (!href) return null;

  return (
    <div className="bg-card relative h-full w-full">
      <iframe
        src={withEmbed(href)}
        title={win.params.title}
        className="h-full w-full border-0"
        style={{ visibility: dragging ? "hidden" : "visible" }}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && !dragging ? (
        <div className="bg-card absolute inset-0 p-5" aria-hidden="true">
          <div className="animate-pulse space-y-3">
            <div className="bg-bg-soft h-6 w-40 rounded" />
            <div className="bg-bg-soft h-24 w-full rounded" />
            <div className="bg-bg-soft h-4 w-3/4 rounded" />
            <div className="bg-bg-soft h-4 w-2/3 rounded" />
          </div>
        </div>
      ) : null}
      {dragging ? (
        <div className="bg-card absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="text-text-faint text-[13px] font-medium">{win.params.title}</span>
        </div>
      ) : null}
    </div>
  );
}
