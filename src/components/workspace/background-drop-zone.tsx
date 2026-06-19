"use client";

import { Layers } from "lucide-react";
import { useWindowStore, isDuplicate } from "./window-store";
import { backgroundDropZone } from "./window-geometry";

/**
 * 배경 드롭 칩 — 라우트 창을 드래그해 상단 중앙에 가져오면 떠서 "여기 놓으면 배경으로"를 안내.
 * 칩 위에 올리면(dragBackground) 강조. 시각 전용(pointer-events:none) — 실제 드롭은 드래그 훅의 기하 판정.
 * 스냅 바와 독립이라 창이 1개여도 노출되며, 타이틀바 "배경으로 보내기" 버튼과 공존(중복 경로).
 */
export function BackgroundDropZone() {
  const draggingId = useWindowStore((s) => s.draggingId);
  const dragNearTop = useWindowStore((s) => s.dragNearTop);
  const dragBackground = useWindowStore((s) => s.dragBackground);
  const bounds = useWindowStore((s) => s.bounds);
  // 복제본(#n)은 배경 시스템 비참여 → 드래그 중에도 배경 칩 미노출(window-only).
  const isRoute = useWindowStore((s) =>
    s.draggingId ? s.windows[s.draggingId]?.kind === "route" && !isDuplicate(s.draggingId) : false,
  );

  if (!draggingId || !isRoute || !dragNearTop) return null;
  const z = backgroundDropZone(bounds);
  return (
    <div
      className="animate-in fade-in-0 slide-in-from-top-1 pointer-events-none absolute top-0 left-0 z-[61] duration-150"
      style={{ transform: `translate(${z.x}px, ${z.y}px)`, width: z.w, height: z.h }}
      aria-hidden="true"
    >
      <div
        className={`flex h-full w-full items-center justify-center gap-1.5 rounded-full border text-[11px] font-medium transition-colors ${
          dragBackground
            ? "border-primary/70 bg-primary/20 text-primary"
            : "border-line bg-card/90 text-text-dim supports-backdrop-filter:backdrop-blur-sm"
        }`}
      >
        <Layers size={12} />
        {dragBackground ? "놓으면 배경으로" : "배경으로 보내기"}
      </div>
    </div>
  );
}
