"use client";

import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useWindowStore } from "./window-store";
import { snapBarHitTest, snapZoneForPoint, type LayoutTemplate, type Rect, type SnapZone } from "./window-geometry";
import { WINDOW_TRANSITION, prefersReducedMotion } from "./motion";

type DragLayout = { template: LayoutTemplate; slot: number };
function openCount() {
  const s = useWindowStore.getState();
  return s.order.filter((id) => !s.windows[id]?.minimized).length;
}
function sameLayout(a: DragLayout | null, b: DragLayout | null) {
  return a?.template === b?.template && a?.slot === b?.slot;
}

/**
 * 타이틀바 드래그 — 이동 중에는 store를 안 건드리고 ref 엘리먼트의 transform만
 * 직접 갱신(60fps, 리렌더 0), pointerup에 한 번 store에 commit. 가장자리 근처면
 * 스냅 존을 store.snapPreview로 알려 캔버스가 고스트를 그린다.
 */
export function usePointerDrag(id: string, elRef: RefObject<HTMLDivElement | null>) {
  const startRef = useRef<{ px: number; py: number; rect: Rect } | null>(null);
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoneRef = useRef<SnapZone>(null);
  const layoutRef = useRef<DragLayout | null>(null);

  function onPointerDown(e: RPointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const s = useWindowStore.getState();
    let w = s.windows[id];
    if (!w) return;
    s.focus(id);
    // 최대화 창을 잡고 끌면 Windows처럼 이전 크기로 복원되어 커서를 따라온다.
    if (w.maximized) {
      s.unmaximizeUnderPointer(id, e.clientX - s.origin.left, e.clientY - s.origin.top);
      w = useWindowStore.getState().windows[id]!;
    }
    startRef.current = { px: e.clientX, py: e.clientY, rect: w.rect };
    posRef.current = { x: w.rect.x, y: w.rect.y };
    zoneRef.current = null;
    s.setDragging(id); // 드래그 중 iframe 숨김 → 부드러운 이동
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: RPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start) return;
    const x = start.rect.x + (e.clientX - start.px);
    const y = start.rect.y + (e.clientY - start.py);
    posRef.current = { x, y };
    const el = elRef.current;
    if (el) el.style.transform = `translate(${x}px, ${y}px)`;
    // 스테이지 로컬 좌표(뷰포트 포인터 − 스테이지 오프셋)
    const store = useWindowStore.getState();
    const { bounds, origin } = store;
    const sx = e.clientX - origin.left;
    const sy = e.clientY - origin.top;
    // 스냅 레이아웃 바 우선 → 있으면 바 슬롯, 없으면 가장자리/모서리 존
    const hit = snapBarHitTest(sx, sy, bounds, openCount());
    if (hit) {
      if (!sameLayout(layoutRef.current, hit)) {
        layoutRef.current = hit;
        store.setDragLayout(hit);
      }
      if (zoneRef.current !== null) {
        zoneRef.current = null;
        store.setSnapPreview(null);
      }
    } else {
      if (layoutRef.current) {
        layoutRef.current = null;
        store.setDragLayout(null);
      }
      const zone = snapZoneForPoint(sx, sy, bounds);
      if (zone !== zoneRef.current) {
        zoneRef.current = zone;
        store.setSnapPreview(zone);
      }
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start) return;
    const store = useWindowStore.getState();
    const layout = layoutRef.current;
    const zone = zoneRef.current;
    if (layout) store.applyDragLayout(id, layout.template, layout.slot);
    else if (zone) store.snap(id, zone);
    else store.setRect(id, { ...start.rect, x: posRef.current.x, y: posRef.current.y });
    store.setSnapPreview(null);
    store.setDragLayout(null);
    // 글라이드 레시피: 커밋된 rect로 transition 켠 채 imperative 적용 → 드롭→최종 애니메이트,
    // 항상 finalRect를 써서 desync(불변 rect 시 잔존) 없음. 제자리 드롭은 동일값이라 무애니.
    const el = elRef.current;
    const fr = useWindowStore.getState().windows[id]?.rect;
    if (el && fr) {
      el.style.transition = prefersReducedMotion() ? "none" : WINDOW_TRANSITION;
      el.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
      el.style.width = `${fr.w}px`;
      el.style.height = `${fr.h}px`;
    }
    store.setDragging(null);
    startRef.current = null;
    zoneRef.current = null;
    layoutRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return { onPointerDown, onPointerMove, onPointerUp };
}
