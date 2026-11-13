"use client";

import { useEffect, useState } from "react";

export function isMobileCameraDevice(nav: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints" | "mediaDevices">): boolean {
  const mobile = /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1); // iPad desktop UA
  return mobile && typeof nav.mediaDevices?.getUserMedia === "function";
}

/** No permission prompt on page load. Desktop webcams never expose the mobile-only action. */
export function useMobileCamera() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!isMobileCameraDevice(navigator)) return;
    let cancelled = false;
    const devices = navigator.mediaDevices;
    const check = async () => {
      let hasCamera = true;
      try {
        if (devices.enumerateDevices) {
          const inputs = await devices.enumerateDevices();
          // Some mobile browsers omit all devices before permission. Let the explicit button ask.
          hasCamera = inputs.length === 0 || inputs.some(d => d.kind === "videoinput");
        }
      } catch { /* Device enumeration may be hidden until the user opens the camera. */ }
      if (!cancelled) setAvailable(hasCamera);
    };
    void check();
    devices.addEventListener?.("devicechange", check);
    return () => { cancelled = true; devices.removeEventListener?.("devicechange", check); };
  }, []);
  return available;
}
