/**
 * Accept only local destinations. A leading slash alone also accepts //host
 * and /\\host, which browsers interpret as external navigation.
 */
export function safeLoginNext(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://aywa.invalid");
    if (url.origin !== "https://aywa.invalid") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("//") || /[\\\\\u0000-\u0020\u007f]/.test(pathname)) return null;
    // Avoid returning to login, including normalized /x/../login paths.
    if (/^\/login(?:\/|$)/i.test(pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/**
 * 로그인 직후 풀 문서 이동의 목적지 — 언제나 `/home`을 거친다(2026-09-23 전수 점검 M1).
 * `/home`이 `login=1`을 보고 로그인 기록(login_events)을 남긴 뒤, 안전한 `next`가 있으면 그리로, 없으면
 * 역할·과목 홈으로 보낸다. 로그인 폼이 브라우저에서 직접 로그인하므로 기록을 남길 서버 자리가 여기뿐이다.
 * ⚠️ `next`의 해시(#…)는 서버로 안 가므로 쿼리에 실어 넘긴다.
 */
export function loginLandingHref(next: unknown): string {
  const safe = safeLoginNext(next);
  return safe ? `/home?login=1&next=${encodeURIComponent(safe)}` : "/home?login=1";
}
