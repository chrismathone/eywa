"use client";

import { useCallback, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { CAPSULE_EXPANDED_WIDTH, CAPSULE_HEIGHT, CAPSULE_WIDTH, type Box } from "./recording-panel-placement";
import { CAPSULE_EDGE, clampCapsule, settleCapsule } from "./recording-capsule-layout";

const THRESHOLD = 4;
/** 녹음 아이콘 배치가 바뀌었다 — 열려 있는 정보창이 다른 아이콘을 덮지 않게 자리를 다시 잡는다(recording-capsule.tsx). */
export const RECORDING_LAYOUT_EVENT = "eywa-recording-layout";
const announceLayout = () => window.dispatchEvent(new Event(RECORDING_LAYOUT_EVENT));
/** 겹침을 풀며 자리로 미끄러지는 시간 — CSS `.anchor[data-settling]`의 전환과 같은 값. */
const SETTLE_MS = 240;
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
/** 다른 녹음 아이콘 자리 — 좌표는 우리가 직접 적은 style 값이라 배치를 다시 재지 않는다. */
function otherCapsules(self: HTMLElement): Box[] {
  return [...document.querySelectorAll<HTMLElement>("[data-recording-id]")]
    .filter((node) => node !== self && node.style.left !== "")
    .map((node) => ({ left: parseFloat(node.style.left), top: parseFloat(node.style.top), width: CAPSULE_WIDTH, height: CAPSULE_HEIGHT }));
}

function pickSide(node: HTMLElement) {
  node.dataset.side = window.innerWidth - node.getBoundingClientRect().left >= CAPSULE_EXPANDED_WIDTH + CAPSULE_EDGE ? "right" : "left";
}
function put(node: HTMLElement, at: { left: number; top: number }) {
  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
}
/** 다른 아이콘과 겹치지 않는 자리로 — 옮겨 갈 때는 짧게 미끄러진다(`data-settling` 동안만 CSS 전환). */
function settle(node: HTMLElement, at: { left: number; top: number }, animate: boolean, timer: { current: ReturnType<typeof setTimeout> | undefined }, after: () => void) {
  const next = settleCapsule(at, otherCapsules(node), viewport());
  if (animate && (next.left !== at.left || next.top !== at.top)) {
    node.dataset.settling = "true";
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { delete node.dataset.settling; after(); announceLayout(); }, SETTLE_MS);
  }
  put(node, next);
  announceLayout();
}

/**
 * Position belongs to a recording's keyed controls, never the audio engine or next session.
 * 새 아이콘은 오른쪽 아래에서 시작해 이미 떠 있는 아이콘을 피해 위로 쌓이고, 끌어서 다른 아이콘에 겹치게 놓으면 그 아이콘의
 * 줄에 간격을 맞춰 붙는다(원장 2026-10-16 "겹쳐지지않고 자동으로 깔끔하게 정렬되게" — 규칙은 recording-capsule-layout.ts).
 * `onMove` runs after the capsule moves or changes its expansion side (drag, drag end, window resize)
 * so an open panel follows it. Dragging never closes the panel (원장 2026-10-14).
 */
export function useRecordingPosition(onMove: () => void) {
  const anchor = useRef<HTMLDivElement>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { anchor.current = node; }, []);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const moved = useRef(onMove);
  useLayoutEffect(() => { moved.current = onMove; });

  function chooseSide() {
    const node = anchor.current;
    if (!node) return;
    pickSide(node);
    moved.current();
  }
  useLayoutEffect(() => {
    const node = anchor.current;
    if (!node) return;
    // Every new request starts at the lower right, above the icons already showing. No saved drag coordinates.
    const timer = settleTimer;
    const after = () => moved.current();
    settle(node, { left: window.innerWidth - CAPSULE_WIDTH - CAPSULE_EDGE, top: window.innerHeight - CAPSULE_HEIGHT - 80 }, false, timer, after);
    node.dataset.side = "left";
    const onResize = () => {
      settle(node, { left: parseFloat(node.style.left), top: parseFloat(node.style.top) }, false, timer, after);
      pickSide(node);
      moved.current();
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(timer.current);
      // 아이콘이 사라지면(안내 닫기·다른 계정) 남은 정보창이 그 빈자리를 쓸 수 있다.
      queueMicrotask(announceLayout);
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || !anchor.current) return;
    suppressClick.current = false;
    const rect = anchor.current.getBoundingClientRect();
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    const node = anchor.current;
    if (!current || current.id !== event.pointerId || !node) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    if (!current.moved) {
      current.moved = true;
      node.dataset.dragging = "true";
    }
    event.preventDefault();
    put(node, clampCapsule({ left: current.left + dx, top: current.top + dy }, viewport()));
    moved.current();
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    const node = anchor.current;
    if (!current || current.id !== event.pointerId) return;
    suppressClick.current = current.moved;
    drag.current = null;
    if (node) {
      delete node.dataset.dragging;
      // 놓은 자리가 다른 아이콘과 겹치면 그 줄에 맞춰 붙인다.
      if (current.moved) settle(node, { left: parseFloat(node.style.left), top: parseFloat(node.style.top) }, true, settleTimer, () => moved.current());
    }
    chooseSide();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function consumeDragClick() {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }
  return { attach, chooseSide, consumeDragClick, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onLostPointerCapture: onPointerEnd };
}
