"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 워크스페이스 사용자 설정(영속, localStorage "eywa-prefs").
 * animations=창 등장/퇴장/전환·교체 애니메이션 on/off. OFF면 즉시 전환(모션 0).
 * 설정 토글은 UserMenu(우하단 사용자 메뉴)에서.
 */
type PrefsState = {
  animations: boolean;
  setAnimations: (v: boolean) => void;
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      animations: true,
      setAnimations: (animations) => set({ animations }),
    }),
    { name: "eywa-prefs" },
  ),
);
