import type { Face } from "@/components/face-tabs";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import type { Season } from "./types";

/** 셔틀의 면들 — 경로가 곧 면 키다(FaceTabs active). 착지·게이트도 이 상수를 쓴다. */
export const SHUTTLE_BOARD_PATH = "/shuttle";
export const SHUTTLE_TODAY_PATH = "/shuttle/today";
/** 관제(2026-09-02) — '오늘 등하원'이 찍는 화면이면 이쪽은 보는 화면이다. */
export const SHUTTLE_LIVE_PATH = "/shuttle/live";
/** 실시간 위치(2026-09-03) — 차량이 지도에 뜰 **자리**. 위치 송신·지도 키가 아직 둘 다 없다. */
export const SHUTTLE_TRACK_PATH = "/shuttle/track";

/**
 * 셔틀 면 전환 탭 — 노선 편성 ↔ 오늘 등하원.
 *
 * 🔴 **모바일엔 사이드바가 없다.** 상단 바(MobileTopNav)는 NAV_GROUPS의 **부모 메뉴만** 그리고
 *    하부탭(SUBTABS_BY_MENU)은 펼친 사이드바에만 있다 — 그래서 폰에서 셔틀을 누르면 노선 편성만
 *    열리고 '오늘 등하원'으로 갈 길이 아예 없었다(원장 제보 2026-08-19). 셔틀 선생님은 폰이 1순위라
 *    이 화면 안 탭바가 유일한 통로다.
 * 🔑 라벨·순서는 사이드바 하부탭에서 **파생**한다 — 양쪽을 각각 하드코딩하면 한쪽만 고쳐 갈린다
 *    (수납관리 '회차 확정'이 그렇게 어긋났었다: FaceTabs ↔ 사이드바 동기 규약).
 * 🔑 시즌(학기중/방학중)은 면을 넘어가도 유지한다 — 방학 편성을 보다 탭을 옮겼는데 학기중으로
 *    되돌아가면 "다른 학원 명단"처럼 보인다.
 */
export function shuttleFaces(season: Season): Face[] {
  return (SUBTABS_BY_MENU.shuttle ?? []).map((tab) => ({
    key: tab.href,
    label: tab.label,
    href: `${tab.href}?season=${season}`,
  }));
}
