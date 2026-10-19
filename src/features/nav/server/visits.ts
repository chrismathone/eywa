import "server-only";
import { readMyUiPrefs } from "@/lib/ui-prefs/read";
import { MENU_SEARCH_HIDDEN_KEY, MENU_VISITS_KEY, MENU_VISITS_NS, parseVisits, type MenuVisitMap } from "../menu-visits";

/**
 * 내 메뉴 방문 기록 — 왼쪽 '자주 방문한 메뉴'가 쓴다.
 * ⚠️ 셸 레이아웃은 **창마다** 도는 자리라(B6) 실패해도 화면을 막지 않고 빈 값으로 떨어진다.
 * 🔑 `ui_prefs` 행은 [`readMyUiPrefs`](@/lib/ui-prefs/read)가 요청당 한 번 읽는다 — 같은 레이아웃의 '화면 최대화'가 그 결과를 나눠 쓴다.
 */
export async function getMyMenuVisits(): Promise<MenuVisitMap> {
  const prefs = await readMyUiPrefs();
  const nav = (prefs[MENU_VISITS_NS] ?? {}) as Record<string, unknown>;
  return parseVisits(nav[MENU_VISITS_KEY]);
}

/** 왼쪽 '메뉴 검색' 칸을 숨겼나 — 같은 요청의 `readMyUiPrefs` 한 번을 나눠 쓴다(실패하면 보임). */
export async function getMyMenuSearchHidden(): Promise<boolean> {
  const prefs = await readMyUiPrefs();
  const nav = (prefs[MENU_VISITS_NS] ?? {}) as Record<string, unknown>;
  return nav[MENU_SEARCH_HIDDEN_KEY] === true;
}
