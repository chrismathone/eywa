import { menuKeyForPath, type MenuKey } from "@/lib/permissions";

/**
 * **이용 분석의 화면 식별자**(route key) — 주소 하나를 "어느 화면인가"로 접는다(순수 함수, 서버·클라 공용).
 *
 * 왜 접나: `/students/3f2a…`처럼 **학생마다 다른 주소**를 그대로 쌓으면 같은 '원생 상세' 화면이 수백 줄로 흩어져
 *   "어디를 많이 쓰나"를 셀 수 없다. 그래서 id·날짜 칸은 자리 표시(`[id]`·`[date]`)로 바꾸고,
 *   같은 주소 안에서 **다른 기능**을 여는 파라미터(탭·보기)만 남긴다(`/billing?tab=sessions`).
 *
 * 🔴 **서버가 이 함수로 다시 접어 같은 값이 나올 때만** 받는다(`isCanonicalRouteKey`) — 비콘은 누구나 보낼 수
 *    있으니, 정규형이 아닌 값(학생 이름이 든 주소·긴 쿼리)이 분석 표에 섞이지 않게 하는 유일한 관문이다.
 * ⚠️ 서버·클라 공용 일반 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 */

/** 화면 식별자에 남기는 검색 파라미터 — 같은 주소에서 다른 **기능**을 여는 것만(순서 고정). */
export const ROUTE_PARAMS = ["tab", "view"] as const;

/** 주소 깊이 상한 — 그보다 깊은 칸은 같은 화면의 세부라 버린다. */
const MAX_SEGMENTS = 4;
export const MAX_ROUTE_KEY_LENGTH = 160;

const PLACEHOLDERS = new Set(["[id]", "[date]"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}(?:-\d{2})?$/;
const WORD = /^[a-z][a-z0-9_-]{0,31}$/;
const PARAM_VALUE = /^[a-z0-9_-]{1,32}$/;

/** 주소 한 칸 → 그대로(라우트 이름) 또는 자리 표시. */
export function normalizeSegment(seg: string): string {
  if (PLACEHOLDERS.has(seg)) return seg;
  if (UUID.test(seg)) return "[id]";
  if (DATE.test(seg)) return "[date]";
  // 소문자 낱말만 라우트 이름으로 본다. 숫자가 섞인 긴 토큰(해시·발급 코드)은 id다.
  if (WORD.test(seg) && !(/\d/.test(seg) && seg.length >= 12)) return seg;
  return "[id]";
}

/** 주소(+검색 파라미터) → 화면 식별자. */
export function routeKeyOf(pathname: string, search?: URLSearchParams | string | null): string {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .slice(0, MAX_SEGMENTS)
    .map((s) => {
      try {
        return normalizeSegment(decodeURIComponent(s));
      } catch {
        return "[id]";
      }
    });
  const path = `/${segments.join("/")}`;
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const params: string[] = [];
  for (const name of ROUTE_PARAMS) {
    const value = sp?.get(name)?.toLowerCase();
    if (value && PARAM_VALUE.test(value)) params.push(`${name}=${value}`);
  }
  return params.length > 0 ? `${path}?${params.join("&")}` : path;
}

/** 서버 관문 — 이미 정규형인 식별자만 통과(다시 접어도 같은 값). */
export function isCanonicalRouteKey(key: string): boolean {
  if (!key.startsWith("/") || key.length > MAX_ROUTE_KEY_LENGTH) return false;
  const q = key.indexOf("?");
  const path = q < 0 ? key : key.slice(0, q);
  const query = q < 0 ? "" : key.slice(q + 1);
  return routeKeyOf(path, query) === key;
}

/**
 * 메뉴 표(`menuKeyForPath`)에 없지만 셸에 있는 화면 — 내 정보·메뉴 판·권한 안내.
 * 🔴 셸(`src/app/(shell)`)에 첫 칸이 새로 생기면 메뉴 표나 여기에 넣을 것 — 안 넣으면 그 화면 이용이 **조용히 버려진다**
 *    (가드 `labels-query.test.ts`가 잡는다).
 */
// explore = 연결 탐색(원생·수업·강사 중심 도넛) — 메뉴 밖 화면, 원생·수업·직원 상세의 '연결 탐색' 버튼과 검색으로 연다(2026-11-03).
// marketing·organization·work-records = 시안 이식 화면(2026-11-09) — 메뉴 키가 아직 없어 기타로 센다(정식 메뉴로 들일 때 메뉴 표로 옮긴다).
export const NON_MENU_SHELL_SEGMENTS: ReadonlySet<string> = new Set(["me", "menu", "explore", "marketing", "organization", "work-records"]);

/** 화면 식별자가 속한 메뉴 — 메뉴 표에 없는 주소(내 정보·메뉴 판 등)는 `other`. */
export type UsageMenuKey = MenuKey | "other";

export function menuKeyOfRoute(routeKey: string): UsageMenuKey {
  const q = routeKey.indexOf("?");
  return menuKeyForPath(q < 0 ? routeKey : routeKey.slice(0, q)) ?? "other";
}

/** 실제 셸 화면인가 — 메뉴 경로 · 셸 전용 화면 · 루트만(지어낸 주소가 분석 표를 채우지 못하게). */
export function isTrackedRoute(routeKey: string): boolean {
  if (menuKeyOfRoute(routeKey) !== "other") return true;
  const seg = routeKey.split(/[/?]/)[1] ?? "";
  return seg === "" || NON_MENU_SHELL_SEGMENTS.has(seg);
}
