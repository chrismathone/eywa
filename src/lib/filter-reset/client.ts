import { FILTER_SEEN_COOKIE, FILTER_SEEN_KEEP_SEC, parseFilterSeen, serializeFilterSeen } from "./rules";

/**
 * 필터 10분 초기화의 브라우저 쪽 — '마지막으로 본 시각' 쿠키를 적는다(규칙 [`rules.ts`](./rules.ts)).
 * 브라우저에서만 부른다(문서 쿠키). 지시어 없는 일반 모듈 — 기록기(filter-seen-tracker.tsx)가 쓴다.
 */

function readSeenCookie(): string | null {
  const prefix = `${FILTER_SEEN_COOKIE}=`;
  for (const part of document.cookie.split("; ")) if (part.startsWith(prefix)) return part.slice(prefix.length);
  return null;
}

/** 이 화면을 지금 봤다. */
export function touchFilterSeen(key: string): void {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const map = parseFilterSeen(readSeenCookie());
    map[key] = nowSec;
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    const value = serializeFilterSeen(map, nowSec);
    document.cookie = `${FILTER_SEEN_COOKIE}=${value}; path=/; max-age=${FILTER_SEEN_KEEP_SEC}; samesite=lax${secure}`;
  } catch {
    /* 쿠키를 못 쓰는 환경 — 다음 열 때 기본값으로 열릴 뿐이다 */
  }
}
