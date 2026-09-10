/**
 * 검색 팰릿(Shift+F)의 **데이터 축 계약** — 서버 조회와 클라 팰릿이 함께 읽는 순수 모듈.
 *
 * 🔴 `server/queries.ts`(server-only)에 두면 안 된다 — 클라 컴포넌트가 `PALETTE_LIMIT`처럼 **값**을
 *    읽으면 빌드가 깨지거나 런타임 undefined가 된다([[#61]]·[[#81]]). 타입만이 아니라 상수도 여기.
 */

export type PaletteKind = "student" | "class" | "consultation" | "enrollment";

export type PaletteHit = {
  kind: PaletteKind;
  id: string;
  title: string;
  subtitle: string | null;
};

/**
 * 축마다 몇 건까지 보여 주는가. 실데이터(injaewon)에서 흔한 검색어는 이 상한을 크게 넘는다 —
 * '김' → 원생 252명 · '이' → 상담 1,591건. 그래서 **상한에 걸렸다는 사실을 함께 내려보낸다**(`more`).
 * 8건만 보여 주고 "그게 전부"인 척하면 사람이 "검색이 안 된다"고 읽는다([[#89]]).
 */
export const PALETTE_LIMIT = 8;

/** 한 번의 검색 결과 — `more`엔 상한에 걸린 축만 담긴다(빈 배열이면 전부 다 보여 준 것). */
export type PaletteSearchResult = { hits: PaletteHit[]; more: PaletteKind[] };

export const EMPTY_PALETTE_RESULT: PaletteSearchResult = { hits: [], more: [] };
