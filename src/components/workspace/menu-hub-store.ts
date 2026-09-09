"use client";

import { create } from "zustand";

/**
 * 지금 본문에 떠 있는 **업무군 메뉴 허브** — 왼쪽에서 업무군을 고르면 열리고, 메뉴 버튼을 누르면
 * **배경으로 내려간다**(닫히지 않는다).
 *
 * 🔴 왜 안 닫히나(원장 2026-09-09: *"상담 재원 탭 눌러놓고 학생 상담 누르면 배경이 '메뉴' 전체로 바뀌는데
 *    어색한거 같은데."*): 배경은 `/menu`(메뉴 판 전체)라, 고른 업무군 화면이 사라지면 그 자리에 갑자기
 *    전체 메뉴가 펼쳐진다. 방금 고른 묶음이 배경으로 남으면 ① 화면이 튀지 않고 ② 같은 묶음의 다음 메뉴를
 *    창 뒤에서 바로 이어 열 수 있다.
 * 🔴 **영속하지 않는다**(usePrefs와 별개) — 새로고침했을 때 메뉴 화면이 떠 있으면 "일하다 만 화면"이
 *    사라진 것처럼 보인다. 열린 창은 그대로 살아 있고 허브는 그 위·아래를 오가는 한 겹이다.
 * 🔴 값은 **id와 층뿐**이다 — 창 상태·권한을 여기 담지 않는다(권한은 서버가 내려준 매트릭스, 창은 window-store).
 */
type MenuHubMode =
  /** 창들 **위**를 덮는다 — 메뉴를 고르는 중. */
  | "overlay"
  /** 창들 **아래**에 배경으로 남는다 — 메뉴를 고른 뒤. */
  | "backdrop";

type MenuHubState = {
  /** 열려 있는 업무군 id(`HUB_GROUPS[].id`) — null이면 닫힘. */
  groupId: string | null;
  mode: MenuHubMode;
  open: (id: string) => void;
  close: () => void;
  /** 메뉴를 골랐다 — 닫지 않고 배경으로 내린다. */
  sendToBack: () => void;
  /**
   * 같은 업무군을 다시 누르면 토글 — 단 **배경에 있을 땐 앞으로 올린다**(닫지 않는다).
   * 배경에 깔린 것을 한 번 더 눌러 닫아 버리면 "메뉴를 보려고 눌렀는데 사라졌다"가 된다.
   */
  toggle: (id: string) => void;
};

export const useMenuHub = create<MenuHubState>((set, get) => ({
  groupId: null,
  mode: "overlay",
  open: (id) => set({ groupId: id, mode: "overlay" }),
  close: () => set({ groupId: null, mode: "overlay" }),
  sendToBack: () => set((s) => (s.groupId ? { mode: "backdrop" } : s)),
  toggle: (id) => {
    const { groupId, mode } = get();
    if (groupId !== id) return set({ groupId: id, mode: "overlay" });
    if (mode === "backdrop") return set({ mode: "overlay" });
    return set({ groupId: null, mode: "overlay" });
  },
}));
