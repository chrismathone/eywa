"use client";

import { useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { useWindowStore } from "./window-store";
import {
  backgroundDropZone,
  pointInRect,
  snapBarHitTest,
  snapZoneForPoint,
  SNAP_BAR_BG_OFFSET,
  type LayoutTemplate,
  type Rect,
  type SnapZone,
} from "./window-geometry";
import { WINDOW_TRANSITION, motionDisabled } from "./motion";

type DragLayout = { template: LayoutTemplate; slot: number };
function openCount() {
  const s = useWindowStore.getState();
  return s.order.filter((id) => !s.windows[id]?.minimized).length;
}
function sameLayout(a: DragLayout | null, b: DragLayout | null) {
  return a?.template === b?.template && a?.slot === b?.slot;
}

const DRAG_THRESHOLD = 4; // 이만큼 움직여야 드래그 시작(미만은 클릭 → 바 플래시/iframe 리로드 방지)
const REVEAL_TOP = 44; // 스냅 바 소환: 드래그로 포인터를 상단 이 px 안까지 "올려야" 뜸(그랩/선택만으론 안 뜸)
const KEEP_TOP = 160; // 히스테리시스: 소환 후엔 이 아래로 내려가야 닫힘(바 칸 호버 여유 확보)

/**
 * 타이틀바 드래그 — 이동 중에는 store를 안 건드리고 ref 엘리먼트의 transform만 직접 갱신
 * (60fps, 리렌더 0), pointerup에 한 번 commit. threshold 미만 이동은 "클릭"으로 보고
 * draggingId를 세팅하지 않음(클릭 시 바 깜빡임·iframe 리로드 없음). 상단 밴드에선 스냅
 * 레이아웃 바, 그 외엔 가장자리/모서리 존을 store에 알려 캔버스가 미리보기를 그린다.
 */
export function usePointerDrag(
  id: string,
  elRef: RefObject<HTMLDivElement | null>,
  onDropBackground?: () => void,
) {
  const startRef = useRef<{ px: number; py: number; rect: Rect } | null>(null);
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoneRef = useRef<SnapZone>(null);
  const layoutRef = useRef<DragLayout | null>(null);
  const startedRef = useRef(false);
  const nearTopRef = useRef(false);
  const bgRef = useRef(false); // 포인터가 배경 드롭 칩 위(드롭 시 swapToBackground)

  function onPointerDown(e: RPointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const s = useWindowStore.getState();
    const w = s.windows[id];
    if (!w) return;
    s.focus(id);
    startRef.current = { px: e.clientX, py: e.clientY, rect: w.rect };
    posRef.current = { x: w.rect.x, y: w.rect.y };
    zoneRef.current = null;
    layoutRef.current = null;
    startedRef.current = false;
    nearTopRef.current = false;
    bgRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: RPointerEvent<HTMLElement>) {
    const start = startRef.current;
    if (!start) return;
    // threshold 전 = 클릭 후보. 미세 이동은 무시(드래그 시작 안 함).
    if (!startedRef.current) {
      if (Math.abs(e.clientX - start.px) < DRAG_THRESHOLD && Math.abs(e.clientY - start.py) < DRAG_THRESHOLD) {
        return;
      }
      startedRef.current = true;
      const s = useWindowStore.getState();
      // 최대화/스냅/타일 창을 끌면 Windows처럼 자유(이전) 크기로 복원되어 커서를 따라온다.
      if (s.windows[id]?.maximized || s.windows[id]?.snapped) {
        s.restoreUnderPointer(id, e.clientX - s.origin.left, e.clientY - s.origin.top);
        const w = useWindowStore.getState().windows[id];
        if (w) startRef.current = { px: e.clientX, py: e.clientY, rect: w.rect };
      }
      useWindowStore.getState().setDragging(id); // iframe 숨김 → 부드러운 이동
    }
    const cur = startRef.current;
    if (!cur) return;
    const x = cur.rect.x + (e.clientX - cur.px);
    // 상단 클램프: 타이틀바(드래그 핸들)가 헤더/스냅바 위로 사라지지 않도록 스테이지 top(0) 아래 유지.
    // 포인터(sy)는 계속 위로 갈 수 있어 스냅 바 소환엔 영향 없음.
    const y = Math.max(0, cur.rect.y + (e.clientY - cur.py));
    posRef.current = { x, y };
    const el = elRef.current;
    if (el) el.style.transform = `translate(${x}px, ${y}px)`;
    // 스테이지 로컬 좌표(뷰포트 포인터 − 스테이지 오프셋)
    const store = useWindowStore.getState();
    const { bounds, origin } = store;
    const sx = e.clientX - origin.left;
    const sy = e.clientY - origin.top;
    const nearTop = nearTopRef.current ? sy <= KEEP_TOP : sy <= REVEAL_TOP;
    if (nearTop !== nearTopRef.current) {
      nearTopRef.current = nearTop;
      store.setDragNearTop(nearTop);
    }
    // 배경 드롭 칩(라우트 창 한정) 위면 최우선 — "배경으로 보내기"(스냅보다 우선).
    const isRoute = store.windows[id]?.kind === "route";
    if (isRoute && nearTop && pointInRect(sx, sy, backgroundDropZone(bounds))) {
      if (!bgRef.current) {
        bgRef.current = true;
        store.setDragBackground(true);
      }
      if (layoutRef.current) {
        layoutRef.current = null;
        store.setDragLayout(null);
      }
      if (zoneRef.current !== null) {
        zoneRef.current = null;
        store.setSnapPreview(null);
      }
      return;
    }
    if (bgRef.current) {
      bgRef.current = false;
      store.setDragBackground(false);
    }
    // 상단 밴드 + 바 칸 위면 레이아웃 슬롯, 그 외엔 가장자리/모서리 존. 배경 칩이 떠 있으면(라우트)
    // 스냅 바는 SNAP_BAR_BG_OFFSET만큼 아래로 밀리므로 히트테스트 py도 동일 보정.
    const barOffset = isRoute ? SNAP_BAR_BG_OFFSET : 0;
    const hit = nearTop ? snapBarHitTest(sx, sy - barOffset, bounds, openCount()) : null;
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
    startRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // 단순 클릭(threshold 미달): 포커스만(이미 down에서) — 바/iframe 리로드 없음.
    if (!start || !startedRef.current) {
      startedRef.current = false;
      zoneRef.current = null;
      layoutRef.current = null;
      return;
    }
    const store = useWindowStore.getState();
    // 배경 드롭: 라우트 창을 배경 칩에 놓음 → 호출부(handleSwapToBackground)가 router.push + swapToBackground.
    if (bgRef.current && onDropBackground) {
      onDropBackground();
      store.setSnapPreview(null);
      store.setDragLayout(null);
      store.setDragNearTop(false);
      store.setDragBackground(false);
      store.setDragging(null);
      startedRef.current = false;
      zoneRef.current = null;
      layoutRef.current = null;
      nearTopRef.current = false;
      bgRef.current = false;
      return;
    }
    const layout = layoutRef.current;
    const zone = zoneRef.current;
    if (layout) store.applyDragLayout(id, layout.template, layout.slot);
    else if (zone) store.snap(id, zone);
    else store.setRect(id, { ...start.rect, x: posRef.current.x, y: posRef.current.y });
    store.setSnapPreview(null);
    store.setDragLayout(null);
    store.setDragNearTop(false);
    // 글라이드 레시피: 커밋된 rect로 transition 켠 채 imperative 적용 → 드롭→최종 애니메이트,
    // 항상 finalRect를 써서 desync(불변 rect 시 잔존) 없음. 제자리 드롭은 동일값이라 무애니.
    const el = elRef.current;
    const fr = useWindowStore.getState().windows[id]?.rect;
    if (el && fr) {
      el.style.transition = motionDisabled() ? "none" : WINDOW_TRANSITION;
      el.style.transform = `translate(${fr.x}px, ${fr.y}px)`;
      el.style.width = `${fr.w}px`;
      el.style.height = `${fr.h}px`;
    }
    store.setDragging(null);
    startedRef.current = false;
    zoneRef.current = null;
    layoutRef.current = null;
    nearTopRef.current = false;
    bgRef.current = false;
  }

  return { onPointerDown, onPointerMove, onPointerUp };
}
