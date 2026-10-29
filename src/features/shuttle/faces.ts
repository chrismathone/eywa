import type { Face } from "@/components/face-tabs";
import { SUBTABS_BY_MENU } from "@/lib/navigation";
import type { Season } from "./types";

/** 셔틀의 면들 — 경로가 곧 면 키다(FaceTabs active). 착지·게이트도 이 상수를 쓴다. */
export const SHUTTLE_BOARD_PATH = "/shuttle";
export const SHUTTLE_TODAY_PATH = "/shuttle/today";
/** 주간 시간표(2026-10-08) — 회차마다 [정류장 × 요일] 표. 구글 시트 탑승현황 모양의 보기 전용 면. */
export const SHUTTLE_WEEK_PATH = "/shuttle/week";
/** 학부모 등하원 — 학부모에게 보이는 오늘 등하원을 관리자가 아이별로 확인하는 면. */
export const SHUTTLE_PARENT_RIDES_PATH = "/shuttle/parent-rides";
/** 관제(2026-09-02) — '오늘 등하원'이 찍는 화면이면 이쪽은 보는 화면이다. */
export const SHUTTLE_LIVE_PATH = "/shuttle/live";
/**
 * 실시간 위치(2026-09-03) — 카카오 지도 + 호차·회차별 보기(2026-10-08). 🔒 **원장·관리자·총괄 전용**(사용자 2026-10-08
 * "관리자 계정들만") — 탭 줄엔 `shuttleFaces(season, { track: true })`일 때만 선다(SUBTABS_BY_MENU엔 창 식별 때문에 남긴다).
 */
export const SHUTTLE_TRACK_PATH = "/shuttle/track";
/** 가까운 노선 찾기(2026-10-26) — 학부모 탭 4와 같은 화면. 🔒 실시간 위치와 같은 관리자 전용. */
export const SHUTTLE_NEARBY_PATH = "/shuttle/nearby";
/** 탑승 학생 시간표(2026-10-27) — 셔틀 타는 학생만 이번 주 수업·셔틀을 나란히. 🔒 관리자 전용. */
export const SHUTTLE_CLASSES_PATH = "/shuttle/classes";
/** 관리자에게만 서는 면 — 탭 줄은 `track`일 때만 붙인다. */
const ADMIN_FACE_PATHS: readonly string[] = [SHUTTLE_TRACK_PATH, SHUTTLE_NEARBY_PATH, SHUTTLE_CLASSES_PATH];

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
export function shuttleFaces(season: Season, opts: { track?: boolean } = {}): Face[] {
  return (SUBTABS_BY_MENU.shuttle ?? [])
    // 🔒 실시간 위치는 관리자에게만 — 판정은 서버(`isShuttleAdmin`)가 하고 화면은 그 결과(`track`)만 받는다.
    .filter((tab) => opts.track || !ADMIN_FACE_PATHS.includes(tab.href))
    .map((tab) => ({
      key: tab.href,
      label: tab.label,
      href: `${tab.href}?season=${season}`,
    }));
}
