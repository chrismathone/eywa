"use client";

import { useSyncExternalStore } from "react";

export function isMobileCameraDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">, touchOnly = false): boolean {
  const mobile = /Android|iPhone|iPad|iPod/i.test(`${nav.userAgent} ${nav.platform}`)
    || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1); // iPad desktop UA
  // Desktop-site mode can replace both UA and platform. Touch-only input still identifies the phone/tablet.
  return mobile || (nav.maxTouchPoints > 0 && touchOnly);
}

const POINTER_QUERIES = ["(any-pointer: coarse)", "(any-pointer: fine)"] as const;
function subscribeInput(change: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const queries = POINTER_QUERIES.map(query => window.matchMedia(query));
  queries.forEach(query => query.addEventListener?.("change", change));
  return () => queries.forEach(query => query.removeEventListener?.("change", change));
}

function mobileSnapshot() {
  const touchOnly = typeof window.matchMedia === "function"
    && window.matchMedia(POINTER_QUERIES[0]).matches && !window.matchMedia(POINTER_QUERIES[1]).matches;
  return isMobileCameraDevice(navigator, touchOnly);
}
const serverSnapshot = () => false;

/** Camera permission/device lists do not determine visibility: mobile browsers also have native file capture. */
export function useMobileCamera() {
  return useSyncExternalStore(subscribeInput, mobileSnapshot, serverSnapshot);
}
