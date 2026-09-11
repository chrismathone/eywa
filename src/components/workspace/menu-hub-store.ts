"use client";

import { create } from "zustand";

/** 업무 선택 중에만 열린다. 창을 열거나 닫은 뒤의 배경은 항상 대시보드다. */
type MenuHubState = {
  groupId: string | null;
  open: (id: string) => void;
  close: () => void;
  toggle: (id: string) => void;
};

export const useMenuHub = create<MenuHubState>((set) => ({
  groupId: null,
  open: (id) => set({ groupId: id }),
  close: () => set({ groupId: null }),
  toggle: (id) => set((s) => ({ groupId: s.groupId === id ? null : id })),
}));
