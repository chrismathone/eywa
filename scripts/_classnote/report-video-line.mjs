/**
 * 수업보고서 ClassNote 글의 **'영상 제출' 줄**(원장 2026-10-01 *"영상 제출 링크를 함께 붙이자. 링크는 일주일 후에 소멸."*).
 *
 * 글 본문 = `{주소}/r/{공유 토큰}` 한 줄(지금까지) → 붙일 때만 둘째 줄 `영상 제출: {주소}/v/{제출 토큰}`.
 * 붙일지·토큰은 **앱이 정한다**(`POST /api/internal/video-submit-link` — 영상 과제 있음 + 검사 대상 반 + 지점 기능·Drive·SQL).
 * 🔴 어떤 실패도 보고서 발송을 막지 않는다 — 못 받으면 줄 없이 그대로 보낸다(`fetchVideoSubmitLine`은 throw하지 않는다).
 *
 * 🔴 **본문 일치 판정이 두 모양을 다 알아야 한다** — 중복 게시 방지(ⓐⓑⓒ)·반별 교차 확인·회수는 "이 보고서의 글"을
 *    본문으로 찾는다(`findChildReportId`). 줄이 붙은 글을 옛 판정(본문 === 공유 링크)으로 찾으면 못 알아봐서
 *    재시도에 **같은 글을 한 번 더** 올리고, 회수는 "이미 없음"으로 거짓 성공한다. 그래서 판정은 `sameReportContent` 하나로:
 *    첫 줄이 이 보고서의 공유 링크 **그대로**이고, 있으면 둘째 줄이 정확히 이 모양일 때만(남의 글을 우리 글로 보지 않게 엄격히).
 *    재시도마다 제출 토큰은 새로 받으므로(앱은 원문을 저장하지 않는다) 둘째 줄의 토큰 값은 비교하지 않는다 — 공유 링크가 보고서마다 고유하다.
 */
export const VIDEO_LINE_LABEL = "영상 제출: ";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 게시 본문 — 제출 주소가 없으면 공유 링크 한 줄(지금까지와 글자까지 같다). */
export function reportPostContent(shareUrl, videoUrl) {
  return videoUrl ? `${shareUrl}\n${VIDEO_LINE_LABEL}${videoUrl}` : shareUrl;
}

/** 둘째 줄 앞의 줄 구분 — ClassNote가 저장하며 바꿀 수 있는 모양(`\r\n`·`<br>`·앞뒤 공백)을 받아 준다. */
const LINE_SEP = String.raw`(?:[ \t]*(?:\r?\n|<br\s*/?>)[ \t]*)+`;
const VIDEO_TAIL = String.raw`\s*https?://[^\s/<]+(?:/[^\s<]*)?/v/[A-Za-z0-9_-]{43}\s*$`;

/**
 * 이 ClassNote 글이 그 공유 링크의 보고서 글인가 — 한 줄(옛 글) 또는 '영상 제출' 줄이 붙은 글.
 * 저장 모양을 실측하기 전이라 줄 구분은 너그럽게(못 알아보면 재시도가 같은 글을 또 올린다) — 첫 줄 = 공유 링크 **그대로**,
 * 둘째 줄 = 영상 제출 주소 하나뿐이라는 점은 엄격하다(남의 글을 우리 글로 보지 않게).
 */
export function sameReportContent(content, shareUrl) {
  if (typeof content !== "string" || typeof shareUrl !== "string" || !shareUrl) return false;
  if (content === shareUrl) return true;
  return new RegExp(`^${escapeRe(shareUrl)}${LINE_SEP}${escapeRe(VIDEO_LINE_LABEL.trim())}${VIDEO_TAIL}`).test(content);
}

/**
 * 앱에 이 보고서의 제출 토큰을 묻는다 → `{shareBase}/v/{토큰}` 또는 null(붙이지 않음·실패·앱이 아직 모름).
 * 10초 안에 못 받으면 줄 없이 보낸다. 시크릿이 없으면 묻지도 않는다.
 */
export async function fetchVideoSubmitLine({ base, shareBase, reportId, secret, fetchImpl = fetch, timeoutMs = 10_000 }) {
  if (!secret || !base || !shareBase || !reportId) return null;
  try {
    const res = await fetchImpl(`${base}/api/internal/video-submit-link`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-eywa-internal": secret },
      body: JSON.stringify({ reportId }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const token = data?.token;
    return typeof token === "string" && TOKEN_RE.test(token) ? `${String(shareBase).replace(/\/+$/, "")}/v/${token}` : null;
  } catch {
    return null;
  }
}
