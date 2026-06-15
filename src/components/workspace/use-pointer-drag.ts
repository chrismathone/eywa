"use client";

import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useWindowStore } from "./window-store";
import { snapZoneForPoint, type Rect, type SnapZone } from "./window-geometry";

/**
 * 타이틀바 드래그 — 이동 중에는 store를 안 건드리고 ref 엘리먼트의 transform만
 * 직접 갱신(60fps, 리렌더 0), pointerup에 한 번 store에 commit. 가장자리 근처면
 * 스냅 존을 store.snapPreview로 알려 캔버스가 고스트를 그린다.
 */
export function usePointerDrag(id: string, elRef: RefObject<HTMLDivElement | null>) {
  const startRef = useRef<{ px: number; py: number; rect: Rect } | null>(null);
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoneRef = useRef<SnapZone>(null);

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
    // 스냅 감지는 스테이지 로컬 좌표로(뷰포트 포인터 − 스테이지 오프셋)
    const { bounds, origin } = useWindowStore.getState();
    const zone = snapZoneForPoint(e.clientX - origin.left, e.clientY - origin.top, bounds);
    if (zone !== zoneRef.current) {
      zoneRef.current = zone;
      useWindowStore.getState().setSnapPreview(zone);
    }
  }

  function onPointerUp(e: RPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start) return;
    const store = useWindowStore.getState();
    const zone = zoneRef.current;
    if (zone) store.snap(id, zone);
    else store.setRect(id, { ...start.rect, x: posRef.current.x, y: posRef.current.y });
    store.setSnapPreview(null);
    // 커밋된 rect로 transform/size 강제 동기화. clamp 결과가 직전 rect와 같으면 React가
    // inline style을 다시 안 써서 드래그 중 imperative transform이 남는 desync를 차단.
    const el = elRef.current;
    const fr = useWindowStore.getState().windows[id]?.rect;
    if (el && fr) {
      el.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
      el.style.width = `${fr.w}px`;
      el.style.height = `${fr.h}px`;
    }
    store.setDragging(null);
    startRef.current = null;
    zoneRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return { onPointerDown, onPointerMove, onPointerUp };
}
