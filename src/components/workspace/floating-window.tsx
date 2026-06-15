"use client";

import { useRef } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { useWindowStore, type Win } from "./window-store";
import { usePointerDrag } from "./use-pointer-drag";
import { usePointerResize } from "./use-pointer-resize";
import { WindowContent } from "./window-content";
import { WINDOW_TRANSITION, prefersReducedMotion } from "./motion";
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
  const dragging = useWindowStore((s) => s.draggingId === win.id);

  // 최소화는 언마운트하지 않고 숨김(display:none) — iframe 문서/스크롤 상태 보존(진짜 멀티태스킹).
  return (
    <div
      ref={outerRef}
      className={`pointer-events-auto absolute top-0 left-0 ${dragging ? "will-change-transform" : ""} ${win.minimized ? "hidden" : ""}`}
      style={{
        transform: `translate(${win.rect.x}px, ${win.rect.y}px)`,
        width: win.rect.w,
        height: win.rect.h,
        zIndex: z,
        // 드래그 중엔 transition 0(1:1 추종), 그 외 store rect 변경(스냅/배치/최대화)은 글라이드
        transition: dragging || prefersReducedMotion() ? "none" : WINDOW_TRANSITION,
      }}
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
          className="bg-bg-soft border-line flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 border-b pr-1 pl-3 select-none active:cursor-grabbing"
        >
          <span className="text-foreground min-w-0 truncate text-[12px] font-semibold">{win.params.title}</span>
          {win.params.subtitle ? <span className="text-text-faint min-w-0 truncate text-[11px]">{win.params.subtitle}</span> : null}
          <span className="flex-1" />

          {/* Windows식 창 컨트롤(우상단): 최소화 _ / 최대화·복원 □ / 닫기 ✕ */}
          <span
            className="flex shrink-0 items-center"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="최소화"
              onClick={() => minimize(win.id)}
              className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-[3px] transition"
            >
              <Minus size={15} strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={win.maximized ? "이전 크기로" : "최대화"}
              onClick={() => toggleMax(win.id)}
              className="text-text-dim hover:bg-line-strong/30 hover:text-foreground flex h-7 w-9 items-center justify-center rounded-[3px] transition"
            >
              {win.maximized ? <Copy size={13} strokeWidth={2} /> : <Square size={13} strokeWidth={2} />}
            </button>
            <button
              type="button"
              aria-label="닫기"
              onClick={() => close(win.id)}
              className="text-text-dim hover:bg-danger flex h-7 w-9 items-center justify-center rounded-[3px] transition hover:text-white"
            >
              <X size={16} strokeWidth={2} />
            </button>
          </span>
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
