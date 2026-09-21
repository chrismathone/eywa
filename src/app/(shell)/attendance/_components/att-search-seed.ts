/**
 * 출석부 학생 검색의 **URL 씨앗**(`?q=`) — 주소창에만 반영하는 얇은 한 겹.
 *
 * 왜 URL인가: 허브에서 학생을 찾아 그 강사 출석부로 **검색어를 들고** 들어가야 하고(원장 2026-08-20),
 * 툴바의 다른 드롭다운(FilterSelect)은 `useSearchParams`로 **다른 param을 보존**하므로 강사·과목을
 * 바꿔도 같은 학생을 계속 찾을 수 있다.
 *
 * 🔴 **저장이 아니다.** `ui_prefs`에도 localStorage에도 안 남는다 — 그냥 `/attendance`를 열면 검색은
 *    비어 있다(search-context.tsx의 "검색어는 저장하지 않는다" 규약 유지).
 * 🔴 **router가 아니라 History API**다. `router.replace`면 타이핑마다 서버 왕복 + 무거운 시트 재렌더가
 *    난다(반응속도 1순위). Next는 `history.pushState/replaceState`를 라우터와 동기화해
 *    `useSearchParams`가 따라온다(Next 16 문서 "Native History API").
 * ⚠️ 이 파일에 `"use client"`도 `import "server-only"`도 붙이지 말 것([[#81]]) — 순수 함수는 Vitest가
 *    그대로 부르고, 서버(page.tsx)가 상수를 읽어도 안전해야 한다.
 */

import { HUB_SEARCH_MAX_QUERY } from "@/features/attendance/hub-search";

/** 씨앗 파라미터 이름 — 링크(att-href)·페이지·툴바가 이 상수 하나만 본다. */
export const SEARCH_SEED_PARAM = "q";

/**
 * 검색어 길이 상한 — **조회가 쓰는 것과 같은 값**이어야 한다. 주소창이 더 길게 허용하면 URL엔 남고
 * 조회는 잘린 말로 찾아 "같은 화면인데 결과가 다르다"가 된다.
 */
export const SEARCH_SEED_MAX = HUB_SEARCH_MAX_QUERY;

/** URL에서 읽은 씨앗 정리 — 앞뒤 공백을 떼고 상한으로 자른다(없으면 빈 문자열). */
export function readSearchSeed(raw: string | undefined | null): string {
  return (raw ?? "").trim().slice(0, SEARCH_SEED_MAX);
}

/**
 * `href`에 씨앗을 반영한 결과 — 값이 비면 **뗀다**. 바뀔 게 없으면 `null`(= 주소창에 손대지 않음).
 * 순수 함수라 Vitest가 그대로 검사한다.
 */
export function urlWithSearchSeed(href: string, value: string): string | null {
  const url = new URL(href, "http://aywa.local");
  const next = readSearchSeed(value);
  if (next === (url.searchParams.get(SEARCH_SEED_PARAM) ?? "")) return null;
  if (next) url.searchParams.set(SEARCH_SEED_PARAM, next);
  else url.searchParams.delete(SEARCH_SEED_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * 주소창의 씨앗을 화면 값과 맞춘다 — **서버 왕복 0**.
 *
 * 🔴 지우기(X·Esc)에서도 반드시 불러야 한다: 안 지우면 새로고침·다른 드롭다운 이동에 **옛 검색어가
 *    되살아나** 빈 화면이 된다(그때 왜 비었는지 말해 주는 건 emptySearchMessage 쪽 몫이다).
 */
export function syncSearchSeedInUrl(value: string): void {
  if (typeof window === "undefined") return;
  const next = urlWithSearchSeed(window.location.href, value);
  if (next === null) return;
  window.history.replaceState(null, "", next);
}
