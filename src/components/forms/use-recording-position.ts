"use client";

import { useCallback, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const SIZE = 48;
const EXPANDED_SIZE = 128;
const EDGE = 16;
const THRESHOLD = 4;
const clamp = (value: number, max: number) => Math.max(EDGE, Math.min(value, Math.max(EDGE, max)));

/** Position belongs to a recording's keyed controls, never the audio engine or next session. */
export function useRecordingPosition(slot: number, closePanel: () => void) {
  const anchor = useRef<HTMLDivElement>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { anchor.current = node; }, []);
  const initialSlot = useRef(slot);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  function chooseSide() {
    const node = anchor.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.dataset.side = window.innerWidth - rect.left >= EXPANDED_SIZE + EDGE ? "right" : "left";
  }
  function place(left: number, top: number) {
    const node = anchor.current;
    if (!node) return;
    node.style.left = `${clamp(left, window.innerWidth - SIZE - EDGE)}px`;
    node.style.top = `${clamp(top, window.innerHeight - SIZE - EDGE)}px`;
  }

  useLayoutEffect(() => {
    const node = anchor.current;
    if (!node) return;
    // Every new request starts at the same lower-right position. No saved drag coordinates.
    node.style.left = `${clamp(window.innerWidth - SIZE - EDGE, window.innerWidth - SIZE - EDGE)}px`;
    node.style.top = `${clamp(window.innerHeight - SIZE - 80 - initialSlot.current * 56, window.innerHeight - SIZE - EDGE)}px`;
    node.dataset.side = "left";
    const onResize = () => {
      const rect = node.getBoundingClientRect();
      node.style.left = `${clamp(rect.left, window.innerWidth - SIZE - EDGE)}px`;
      node.style.top = `${clamp(rect.top, window.innerHeight - SIZE - EDGE)}px`;
      node.dataset.side = window.innerWidth - node.getBoundingClientRect().left >= EXPANDED_SIZE + EDGE ? "right" : "left";
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    if (!current.moved) {
      current.moved = true;
      closePanel();
      if (anchor.current) anchor.current.dataset.dragging = "true";
    }
    event.preventDefault();
    place(current.left + dx, current.top + dy);
  }
  function onPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    suppressClick.current = current.moved;
    drag.current = null;
    if (anchor.current) delete anchor.current.dataset.dragging;
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
