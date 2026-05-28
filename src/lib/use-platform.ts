"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function getServerSnapshot() {
  return false;
}

export function useIsMac() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function modKey(isMac: boolean) {
  return isMac ? "⌘" : "Ctrl";
}
