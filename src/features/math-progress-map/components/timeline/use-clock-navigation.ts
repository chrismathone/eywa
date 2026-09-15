"use client";

import { useEffect, useRef } from "react";
import { wheelPixels } from "../../timeline-navigation";

/** 클릭/키보드로 시계에 초점을 둔 동안만 휠을 월 이동으로 사용한다. */
export function useClockNavigation(month: number, navigate: (month: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const wheel = useRef({ accumulated: 0, lastStep: -Infinity, lastEvent: 0, lastDirection: 0 });
  const armed = useRef(false);
  useEffect(() => {
    const clock = ref.current;
    if (!clock) return;
    const onWheel = (event: WheelEvent) => {
      if (!armed.current || !clock.contains(document.activeElement) || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const now = performance.now();
      const delta = wheelPixels(event.deltaY, event.deltaMode, innerHeight);
      const direction = Math.sign(delta);
      const state = wheel.current;
      const next = month + direction;
      if (!direction || next < 1 || next > 12) return;
      event.preventDefault();
      if (now - state.lastStep < 280 && state.lastDirection === direction) return;
      if (now - state.lastEvent > 180 || Math.sign(state.accumulated) !== direction) state.accumulated = 0;
      state.lastEvent = now;
      state.accumulated += delta;
      if (Math.abs(state.accumulated) < 48) return;
      state.accumulated = 0; state.lastStep = now; state.lastDirection = direction;
      navigate(next);
    };
    const arm = () => { armed.current = true; };
    const disarm = () => { armed.current = false; };
    clock.addEventListener("pointerdown", arm);
    clock.addEventListener("focusin", arm);
    clock.addEventListener("pointerleave", disarm);
    clock.addEventListener("focusout", disarm);
    clock.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clock.removeEventListener("wheel", onWheel);
      clock.removeEventListener("pointerdown", arm); clock.removeEventListener("focusin", arm);
      clock.removeEventListener("pointerleave", disarm); clock.removeEventListener("focusout", disarm);
    };
  }, [month, navigate]);
  return ref;
}
