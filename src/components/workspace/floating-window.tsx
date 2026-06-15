"use client";

import { useRef } from "react";
import { useWindowStore, type Win } from "./window-store";
import { usePointerDrag } from "./use-pointer-drag";
import { usePointerResize } from "./use-pointer-resize";
import { WindowContent } from "./window-content";
import type { ResizeHandle } from "./window-geometry";

const HANDLES: { h: ResizeHandle; cls: string }[] = [
  { h: "n", cls: "top-0 inset-x-3 h-1.5 cursor-n-resize" },
  { h: "s", cls: "bottom-0 inset-x-3 h-1.5 cursor-s-resize" },
  { h: "e", cls: "right-0 inset-y-3 w-1.5 cursor-e-resize" },
  { h: "w", cls: "left-0 inset-y-3 w-1.5 cursor-w-resize" },
  { h: "ne", cls: "top-0 right-0 size-3 cursor-ne-resize" },
  { h: "nw", cls: "top-0 left-0 size-3 cursor-nw-resize" },
  { h: "se", cls: "bottom-0 right-0 size-3 cursor-se-resize" },
  { h: "sw", cls: "bottom-0 left-0 size-3 cursor-sw-resize" },
];

export function FloatingWindow({ win, focused, z }: { win: Win; focused: boolean; z: number }) {
  // outerRef: 위치/크기(transform·width·height)를 드래그/리사이즈가 직접 갱신(리렌더 0)
  const outerRef = useRef<HTMLDivElement>(null);
  const drag = usePointerDrag(win.id, outerRef);
  const resize = usePointerResize(win.id, outerRef);
  const close = useWindowStore((s) => s.close);
  const minimize = useWindowStore((s) => s.minimize);
  const toggleMax = useWindowStore((s) => s.toggleMax);
  const focus = useWindowStore((s) => s.focus);

  if (win.minimized) return null;

  return (
    <div
      ref={outerRef}
      className="pointer-events-auto fixed top-0 left-0 will-change-transform"
      style={{ transform: `translate(${win.rect.x}px, ${win.rect.y}px)`, width: win.rect.w, height: win.rect.h, zIndex: z }}
      onPointerDown={() => focus(win.id)}
    >
      <div
        role="dialog"
        aria-modal={false}
        aria-label={win.params.title}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === "Escape") close(win.id);
        }}
        className={`bg-card animate-in fade-in-0 zoom-in-95 relative flex h-full w-full flex-col overflow-hidden rounded-xl border duration-150 ${
          focused ? "border-primary/30 shadow-modal ring-primary/15 ring-2" : "border-line shadow-card"
        }`}
      >
        {/* 타이틀바 (드래그 핸들) */}
        <div
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onDoubleClick={() => toggleMax(win.id)}
          className="bg-bg-soft border-line flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 border-b px-3 select-none active:cursor-grabbing"
        >
          <span className="flex shrink-0 gap-1.5">
            <button type="button" aria-label="닫기" onPointerDown={(e) => e.stopPropagation()} onClick={() => close(win.id)} className="bg-danger/80 hover:bg-danger size-3 rounded-full transition" />
            <button type="button" aria-label="최소화" onPointerDown={(e) => e.stopPropagation()} onClick={() => minimize(win.id)} className="bg-amber/80 hover:bg-amber size-3 rounded-full transition" />
            <button type="button" aria-label={win.maximized ? "창 복원" : "최대화"} onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleMax(win.id)} className="bg-primary/80 hover:bg-primary size-3 rounded-full transition" />
          </span>
          <span className="text-foreground min-w-0 truncate text-[12px] font-semibold">{win.params.title}</span>
          {win.params.subtitle ? <span className="text-text-faint min-w-0 truncate text-[11px]">{win.params.subtitle}</span> : null}
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1">
          <WindowContent win={win} />
        </div>

        {/* 8방향 리사이즈 핸들 */}
        {HANDLES.map(({ h, cls }) => (
          <div
            key={h}
            onPointerDown={resize.start(h)}
            onPointerMove={resize.onPointerMove}
            onPointerUp={resize.onPointerUp}
            className={`absolute z-10 touch-none ${cls}`}
          />
        ))}
      </div>
    </div>
  );
}
