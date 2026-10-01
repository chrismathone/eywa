import type { Win } from "./window-store";

/**
 * 이전 화면 유지 방식의 **주소 규칙**(순수) — 주소창은 "지금 보이는 화면"을 따라간다.
 * (스토어 ↔ 주소 동기화 훅은 `use-keepalive-follow.ts`, 여기는 판정만 — Vitest가 잠근다.)
 */

/** `embed=1`·해시를 뗀 `경로?쿼리` — 창 iframe의 실제 주소(embed가 붙어 있다)와 주소창 주소를 같은 눈금으로 비교한다. */
export function stripEmbedUrl(url: string): string {
  const [path = "", query] = (url.split("#", 1)[0] ?? url).split("?");
  if (!query) return path;
  // 🔴 URLSearchParams로 다시 직렬화하지 않는다 — `%20`이 `+`로 바뀌는 식으로 **원문과 달라져** 주소창 주소(원문)와 같은 화면인데 다르다고
  //    읽힌다(이미 열린 화면을 다시 불러온다 — 적대 리뷰). embed 쌍만 걷어 낸다.
  const rest = query.split("&").filter((pair) => pair !== "" && pair.split("=", 1)[0] !== "embed");
  return rest.length > 0 ? `${path}?${rest.join("&")}` : path;
}

/**
 * 셸 레이아웃이 **지금 실제로 그리고 있는** 경로 — `useSelectedLayoutSegments()`(셸 레이아웃 아래 세그먼트)를 경로로 잇는다.
 * 라우트 그룹(`(admin)`)은 주소에 없으니 뺀다. 주소만 바꾸는 이동(`pushState`)은 이 값을 안 바꾼다 — 그래서 주소와 비교하면
 * "바탕이 다른 화면을 그리고 있나"를 안다.
 */
export function renderedPathOf(segments: readonly string[] | null | undefined): string {
  // 라우터 밖(테스트·pages)이면 Next가 null을 준다 — 루트로 읽는다(첫 화면으로 본다).
  return `/${(segments ?? []).filter((seg) => !seg.startsWith("(")).join("/")}`;
}

/** 첫 화면(바탕)이 직접 그리는 주소 — 창으로 열지 않는다(`deepLinkWindow`가 null을 돌려주는 것과 같은 축). */
export function isHomePath(path: string, home: string): boolean {
  return path === home || path === "/dashboard" || path === "/menu" || path === "/";
}

type Layout = { windows: Record<string, Win>; focusedId: string | null; nav: Record<string, string[]> };

/** 화면 하나(창 항목)의 **지금 주소** — 창 안 이동을 따라가는 뒤로 기록 맨 위, 아직 보고가 없으면 처음 연 주소. */
export function entryUrl(w: Win, nav: string[] | undefined): string {
  // 학생 요약 창(검색 팰릿의 peek)은 주소가 없다 — 보여 주는 것이 곧 그 원생이라 상세 주소로 읽는다.
  if (w.kind === "student") return `/students/${w.params.id}`;
  return stripEmbedUrl(nav?.[nav.length - 1] ?? w.params.href ?? "/");
}

/** 지금 보이는 화면의 id — 포커스가 있고 숨지 않은 것 하나. 없으면 null(= 첫 화면이 보인다). */
export function visibleId(s: Layout): string | null {
  const w = s.focusedId ? s.windows[s.focusedId] : undefined;
  return w && !w.minimized ? w.id : null;
}

/** 주소창이 가져야 할 주소 — 보이는 화면의 주소, 없으면 첫 화면. */
export function visibleUrl(s: Layout, home: string): string {
  const id = visibleId(s);
  return id ? entryUrl(s.windows[id]!, s.nav[id]) : home;
}
