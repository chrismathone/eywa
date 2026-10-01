"use client";

import { useCallback, useEffect, useRef } from "react";

/** 현재 화면 좌표를 센서보다 먼저 받는다. 스크롤 보정이 든 dnd delta를 좌표로 쓰지 않는다. */
export function useDragPointer() {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    pointer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const track = useCallback((activator: Event | null) => {
    stop();
    const options = { passive: true, capture: true };
    if (activator && "changedTouches" in activator) {
      const touchId = (activator as TouchEvent).changedTouches[0]?.identifier;
      const move = (event: Event) => {
        const touch = Array.from((event as TouchEvent).touches).find((t) => t.identifier === touchId);
        if (touch) pointer.current = { x: touch.clientX, y: touch.clientY };
      };
      // 미리보기에서 빠져 DOM을 떠난 카드도 손가락의 touchmove 대상이 될 수 있다.
      const target = activator.target;
      window.addEventListener("touchmove", move, options);
      target?.addEventListener("touchmove", move, options);
      cleanup.current = () => {
        window.removeEventListener("touchmove", move, true);
        target?.removeEventListener("touchmove", move, true);
      };
    } else {
      const move = (event: MouseEvent) => {
        pointer.current = { x: event.clientX, y: event.clientY };
      };
      window.addEventListener("mousemove", move, options);
      cleanup.current = () => window.removeEventListener("mousemove", move, true);
    }
  }, [stop]);
  return { pointer, track, stop };
}
