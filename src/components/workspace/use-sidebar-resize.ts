"use client";

import { usePrefs } from "./use-prefs";

/**
 * 사이드바 너비 — **고정이다. 접기/펴기만 한다**(원장 2026-09-07: *"왼쪽 탭 크기를 고정으로 가고 접기 펴기만"*).
 *
 * 🔴 폭을 사람이 끌어 바꾸던 것을 걷어냈다(옛 `useSidebarResize`의 드래그·←/→ 조절). 버튼형 메뉴로 바뀌며
 *    왼쪽은 업무군 12줄로 짧아졌고, 폭이 계정마다 다르면 본문 메뉴 격자의 열 수까지 사람마다 달라진다.
 * ⚠️ **캔버스·메뉴 허브가 같은 값을 봐야 한다** — 창 스테이지(`left`)와 허브 패널이 이 폭을 기준으로 자리를
 *    잡으므로, 화면마다 제 숫자를 적으면 창이 사이드바 밑으로 들어가거나 틈이 벌어진다.
 * ⚠️ `usePrefs.sidebarWidth`(옛 저장값)는 **더 이상 읽지 않는다** — 지우지는 않았다(되돌릴 때 그 값이 필요하고,
 *    다른 기기에 남아 있는 값을 마이그레이션할 이유도 없다).
 */
export const SIDEBAR_COLLAPSED_W = 52; // 접힘 레일(아이콘만)
export const SIDEBAR_EXPANDED_W = 216; // 펼침 고정 폭(옛 기본값과 같다 — 지금 화면이 그 폭이다)

/** 지금 사이드바가 차지하는 폭 — 창 스테이지·메뉴 허브가 이 함수를 함께 쓴다. */
export function railWidth(expanded: boolean): number {
  return expanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W;
}

/** 사이드바 상태 — 펼침 여부와 그때의 폭(고정). 토글은 브랜드 줄 버튼이 `usePrefs.toggleSidebar`로 한다. */
export function useSidebarWidth(): { expanded: boolean; width: number } {
  const expanded = usePrefs((s) => s.sidebarExpanded);
  return { expanded, width: railWidth(expanded) };
}
