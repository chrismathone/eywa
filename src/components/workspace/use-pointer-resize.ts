"use client";

import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useWindowStore } from "./window-store";
import { resizeRect, type Rect, type ResizeHandle } from "./window-geometry";

/**
 * 8방향 리사이즈 — 드래그와 동일하게 이동 중엔 ref transform/width/height만 직접
 * 갱신, pointerup에 store commit. 각 핸들 div에 start(handle)/move/up을 바인딩.
 */
export function usePointerResize(id: string, elRef: RefObject<HTMLDivElement | null>) {
  const startRef = useRef<{ px: number; py: number; rect: Rect; handle: ResizeHandle } | null>(null);
  const rectRef = useRef<Rect | null>(null);

  function start(handle: ResizeHandle) {
    return (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const s = useWindowStore.getState();
      const w = s.windows[id];
      if (!w) return;
      s.focus(id);
      startRef.current = { px: e.clientX, py: e.clientY, rect: w.rect, handle };
      rectRef.current = w.rect;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
      e.preventDefault();
    };
  }

  function onPointerMove(e: RPointerEvent<HTMLElement>) {
    const st = startRef.current;
    if (!st) return;
    const r = resizeRect(st.rect, st.handle, e.clientX - st.px, e.clientY - st.py, useWindowStore.getState().bounds);
    rectRef.current = r;
    const el = elRef.current;
    if (el) {
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLElement>) {
    if (!startRef.current || !rectRef.current) return;
    useWindowStore.getState().setRect(id, rectRef.current);
    startRef.current = null;
    rectRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return { start, onPointerMove, onPointerUp };
}
