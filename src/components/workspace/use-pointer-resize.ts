"use client";

import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useWindowStore } from "./window-store";
import { resizeFloor, resizeRect, routeMinSize, type Rect, type ResizeHandle } from "./window-geometry";
import { WINDOW_TRANSITION, motionDisabled } from "./motion";

/**
 * 8방향 리사이즈 — 드래그와 동일하게 이동 중엔 ref transform/width/height만 직접
 * 갱신, pointerup에 store commit. 각 핸들 div에 start(handle)/move/up을 바인딩.
 *
 * 🔴 라우트 창은 **창이 지금 보는 화면의 최소 크기**(`routeMinSize` — `store.resizeBy`와 같은 바닥)에서 멈춘다
 *    (원장 2026-09-03 *"창 크기를 최소 크기보다 줄이려고 할 때 경고를 띄우고 줄어들지 않도록"*). 창 id만으로 재면
 *    출석부 창 안의 출결 모드가 1280에서 멈췄다(전수검사 2026-09-11). 바닥에 닿으면 창 안 `[data-min-hint]`
 *    (FloatingWindow)에 "최소 크기 W×H"를 보인다 — 리렌더 없이 DOM만 만진다(드래그 중 setState 금지 규약 그대로).
 */
export function usePointerResize(id: string, elRef: RefObject<HTMLDivElement | null>) {
  const startRef = useRef<{
    px: number;
    py: number;
    rect: Rect;
    handle: ResizeHandle;
    min: { w: number; h: number } | undefined;
  } | null>(null);
  const rectRef = useRef<Rect | null>(null);

  function start(handle: ResizeHandle) {
    return (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const s = useWindowStore.getState();
      const w = s.windows[id];
      if (!w) return;
      s.focus(id);
      const min = routeMinSize(w, s.nav[id]);
      startRef.current = { px: e.clientX, py: e.clientY, rect: w.rect, handle, min };
      rectRef.current = w.rect;
      s.setDragging(id); // 리사이즈 중 iframe 숨김
      e.currentTarget.setPointerCapture(e.pointerId);
      e.stopPropagation();
      e.preventDefault();
    };
  }

  function onPointerMove(e: RPointerEvent<HTMLElement>) {
    const st = startRef.current;
    if (!st) return;
    const bounds = useWindowStore.getState().bounds;
    const r = resizeRect(st.rect, st.handle, e.clientX - st.px, e.clientY - st.py, bounds, st.min);
    rectRef.current = r;
    const el = elRef.current;
    if (el) {
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
      // 바닥에 닿았을 때만 힌트 — 라우트 창(최소 크기가 있는 창)만.
      const hint = el.querySelector<HTMLElement>("[data-min-hint]");
      if (hint && st.min) {
        const floor = resizeFloor(st.min, bounds);
        const atFloor = r.w <= floor.w || r.h <= floor.h;
        hint.hidden = !atFloor;
        if (atFloor) hint.textContent = `최소 크기 ${st.min.w}×${st.min.h}`;
      }
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLElement>) {
    if (!startRef.current || !rectRef.current) return;
    useWindowStore.getState().setRect(id, rectRef.current);
    // 글라이드 레시피: 커밋된 rect로 transition 켠 채 적용(desync 차단 + 부드러운 마무리).
    const el = elRef.current;
    const fr = useWindowStore.getState().windows[id]?.rect;
    if (el && fr) {
      el.style.transition = motionDisabled() ? "none" : WINDOW_TRANSITION;
      el.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
      el.style.width = `${fr.w}px`;
      el.style.height = `${fr.h}px`;
    }
    useWindowStore.getState().setDragging(null);
    const hint = el?.querySelector<HTMLElement>("[data-min-hint]");
    if (hint) hint.hidden = true;
    startRef.current = null;
    rectRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return { start, onPointerMove, onPointerUp };
}
