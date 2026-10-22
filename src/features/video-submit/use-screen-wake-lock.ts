"use client";

import { useEffect } from "react";

/**
 * 올리는 동안 **화면이 저절로 꺼지지 않게** 붙잡는다(Screen Wake Lock — 원장 2026-10-22 김채현 건).
 * 실측: 10/20 새벽 BS1D 숙제 업로드 다섯 번이 전부 사파리가 화면 밖으로 가는 순간(`hidden`) 멈췄다 — 전송이 초당 약 50KB로
 * 느려 60MB면 20분인데, 폰 자동 잠금(기본 30초~1분)이 그보다 먼저 온다. 학생은 돌아와 이어 올리지 않고 새로 시작했다가 포기했다.
 *  · 지원하지 않는 브라우저(옛 iOS·인앱 등)에서는 아무것도 하지 않는다 — 올리기는 종전 그대로다.
 *  · 화면이 숨으면 브라우저가 잠금을 스스로 푼다 → 다시 보이면 또 잡는다(이어 올리기는 `upload-client.ts`가 한다).
 *  · 사용자가 전원 버튼으로 끄는 것은 막을 수 없다(안내 문구가 맡는다).
 */
type Sentinel = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } };

export function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;
    let alive = true;
    let sentinel: Sentinel | null = null;
    const acquire = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      try {
        const next = await wakeLock.request("screen");
        if (alive) sentinel = next;
        else void next.release().catch(() => {});
      } catch {
        // 배터리 절약 모드 등으로 거절 — 올리기에는 영향이 없다.
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
