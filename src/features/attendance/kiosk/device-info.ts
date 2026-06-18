// 키오스크 기기 메타 추출 — 순수함수. IP/UA는 요청 헤더에서 캡처해 넘겨받는다(여기선 파싱만).

/** x-forwarded-for(쉼표 구분, 첫 항목=클라이언트) 우선, 없으면 x-real-ip. 둘 다 없으면 null. */
export function parseForwardedFor(
  xff: string | null | undefined,
  xRealIp?: string | null | undefined,
): string | null {
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = xRealIp?.trim();
  return real ? real : null;
}

/** User-Agent → 사람이 읽는 기기 종류(대략). iPadOS가 데스크톱 UA를 쓰는 경우는 Mac으로 분류될 수 있음. */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "알 수 없음";
  const s = ua.toLowerCase();
  if (s.includes("ipad")) return "아이패드";
  if (s.includes("iphone")) return "아이폰";
  if (s.includes("android")) return "안드로이드";
  if (s.includes("windows")) return "Windows";
  if (s.includes("macintosh") || s.includes("mac os")) return "Mac";
  if (s.includes("cros")) return "크롬북";
  if (s.includes("linux")) return "Linux";
  return "기타";
}
