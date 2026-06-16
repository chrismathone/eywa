"use client";

import { useRouter } from "next/navigation";
import { Layers } from "lucide-react";
import { useWindowStore } from "./window-store";

/**
 * 배경 탭 스트립 — 상단 중앙. 배경 스택이 2개 이상일 때만 노출(기본 1개=대시보드면 숨김).
 * 좌클릭 = 그 배경으로 전환(router.push → pathname 동기로 맨 위 이동),
 * 우클릭 = 창으로 꺼내기(backgroundToWindow). 드래그 중엔 숨김(상단 스냅 바와 충돌 회피).
 */
export function BackgroundTabs() {
  const router = useRouter();
  const background = useWindowStore((s) => s.background);
  const backgroundToWindow = useWindowStore((s) => s.backgroundToWindow);
  const dragging = useWindowStore((s) => s.draggingId !== null);

  if (background.length <= 1 || dragging) return null;
  const visibleId = background[background.length - 1]?.id;

  function popToWindow(id: string) {
    backgroundToWindow(id);
    // 보이는 배경(맨 위)이 바뀌었을 수 있으니 새 맨 위로 메인 프레임 이동.
    const bg = useWindowStore.getState().background;
    const top = bg[bg.length - 1];
    if (top?.href) router.push(top.href);
  }

  return (
    <div
      data-slot="background-tabs"
      className="border-line bg-card/95 shadow-card pointer-events-auto absolute top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border py-1 pr-2 pl-1.5 backdrop-blur"
    >
      <span className="text-text-faint mr-0.5 flex items-center gap-1 font-mono text-[10px] tracking-wider uppercase">
        <Layers size={11} /> 배경
      </span>
      {background.map((b) => {
        const active = b.id === visibleId;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => b.href && router.push(b.href)}
            onContextMenu={(e) => {
              e.preventDefault();
              popToWindow(b.id);
            }}
            title={`${b.title} — 클릭: 이 배경 보기 / 우클릭: 창으로 꺼내기`}
            className={`max-w-[120px] truncate rounded-full px-2.5 py-0.5 text-[12px] transition ${
              active ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
            }`}
          >
            {b.title}
          </button>
        );
      })}
    </div>
  );
}
