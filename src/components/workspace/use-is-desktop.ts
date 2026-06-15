"use client";

import { useSyncExternalStore } from "react";

// 데스크톱 = 넓은 폭 + 정밀 포인터(마우스). 모바일/태블릿 터치는 false → Stage Manager 미마운트.
const QUERY = "(min-width: 1024px) and (pointer: fine)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
function getSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia(QUERY).matches;
}
function getServerSnapshot() {
  return false; // SSR/모바일 우선 — hydration 후 데스크톱이면 확정
}

export function useIsDesktop() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
