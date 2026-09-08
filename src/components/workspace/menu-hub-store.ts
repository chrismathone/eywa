"use client";

import { create } from "zustand";

/**
 * 지금 본문에 떠 있는 **업무군 메뉴 허브** — 왼쪽에서 업무군을 고르면 열리고, 메뉴 버튼을 누르면 닫힌다.
 *
 * 🔴 **영속하지 않는다**(usePrefs와 별개) — 새로고침했을 때 메뉴 화면이 떠 있으면 "일하다 만 화면"이
 *    사라진 것처럼 보인다. 열린 창은 그대로 살아 있고 허브는 그 위를 잠깐 덮는 층이다.
 * 🔴 값은 **id 하나**뿐이다 — 창 상태·권한을 여기 담지 않는다(권한은 서버가 내려준 매트릭스, 창은 window-store).
 */
type MenuHubState = {
  /** 열려 있는 업무군 id(`HUB_GROUPS[].id`) — null이면 닫힘. */
  groupId: string | null;
  open: (id: string) => void;
  close: () => void;
  /** 같은 업무군을 다시 누르면 닫는다(토글) — 왼쪽 항목이 곧 스위치다. */
  toggle: (id: string) => void;
};

export const useMenuHub = create<MenuHubState>((set, get) => ({
  groupId: null,
  open: (id) => set({ groupId: id }),
  close: () => set({ groupId: null }),
  toggle: (id) => set({ groupId: get().groupId === id ? null : id }),
}));
