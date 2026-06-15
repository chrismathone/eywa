"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 워크스페이스 사용자 설정(영속, localStorage "eywa-prefs").
 * animations=창 등장/퇴장/전환·교체 애니메이션 on/off. OFF면 즉시 전환(모션 0).
 * 이 설정이 **단일 기준** — 기본값만 OS '동작 줄이기'를 따르고, 한 번 토글하면 그 선택이
 * OS를 덮어쓴다(설정 ON이면 reduce-motion이어도 애니메이션을 보여줌). 토글은 UserMenu에서.
 */
type PrefsState = {
  animations: boolean;
  setAnimations: (v: boolean) => void;
};

/** OS '동작 줄이기' 선호 — 설정 기본값 산정용(import 순환 피하려 motion.ts 대신 직접 검사). */
function osReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      animations: !osReducedMotion(), // 기본: OS 따름. 사용자가 토글하면 영속되어 그 값이 우선.
      setAnimations: (animations) => set({ animations }),
    }),
    { name: "eywa-prefs" },
  ),
);
