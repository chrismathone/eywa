"use client";

import { useSyncExternalStore } from "react";

function subscribe(change: () => void) {
  window.addEventListener("resize", change);
  window.visualViewport?.addEventListener("resize", change);
  return () => {
    window.removeEventListener("resize", change);
    window.visualViewport?.removeEventListener("resize", change);
  };
}
const snapshot = () => Math.round(window.visualViewport?.height ?? window.innerHeight);
const serverSnapshot = () => 0;

/** Keep the editor controls above the mobile software keyboard. */
export function usePhotoViewportHeight() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
