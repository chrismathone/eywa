/**
 * 수업보고서 ClassNote 글의 **'영상첨부' 줄**(원장 2026-10-01 *"영상 제출 링크를 함께 붙이자. 링크는 일주일 후에 소멸."*).
 *
 * 글 본문 = `{주소}/r/{공유 토큰}` 한 줄(지금까지 — 링크가 하나뿐이면 그대로) → 영상 링크를 붙일 때만 두 줄에 이름을 단다
 * (원장 2026-10-02 *"보고서 : / 영상첨부 : 이렇게 링크 구분하게"*):
 *     보고서 : {주소}/r/{공유 토큰}
 *     영상첨부 : {주소}/v/{제출 토큰}
 * 붙일지는 **앱이 정한다**(`POST /api/internal/video-submit-link`).
 * 🔑 2026-10-03부터 둘째 줄 = **올리기 사이트 주소 하나**(`영상첨부 : {주소}/v`) — 원장 *"영상숙제 체크하더라도 /v 링크를 안내"* ·
 *    *"학생영상 개별링크는 더이상 생성하지않고"*. 앱이 `{ site: true }`(영상 과제 있음 + 검사 대상 반 + 사이트를 쓰는 지점)를 주면 붙인다.
 *    학생마다 토큰을 받던 예전 응답(`{ token }`)도 계속 받아 준다(앱이 옛 판이어도 같은 모양으로 낸다).
 * 🔴 어떤 실패도 보고서 발송을 막지 않는다 — 못 받으면 줄 없이 그대로 보낸다(`fetchVideoSubmitLine`은 throw하지 않는다).
 *
 * 🔴 **본문 일치 판정이 세 모양을 다 알아야 한다** — 중복 게시 방지(ⓐⓑⓒ)·반별 교차 확인·회수는 "이 보고서의 글"을
 *    본문으로 찾는다(`findChildReportId`). 못 알아보면 재시도에 **같은 글을 한 번 더** 올리고, 회수는 "이미 없음"으로 거짓 성공한다.
 *    그래서 판정은 `sameReportContent` 하나로: ① 공유 링크 한 줄 ② 10-01 모양(`{링크}` + `영상 제출: {주소}`)
 *    ③ 10-02 모양(`보고서 : {링크}` + `영상첨부 : {주소}`). 공유 링크는 **글자까지 그대로**, 둘째 줄은 정확히 그 모양일 때만
 *    (남의 글을 우리 글로 보지 않게 엄격히). 둘째 줄의 주소는 `…/v/{토큰}`(10-01 ~ 10-03) 또는 `…/v`(10-03 ~ 사이트 안내) — 토큰 값은
 *    비교하지 않는다(재시도마다 새로 받았다) · 공유 링크가 보고서마다 고유하다.
 *    ⚠️ 모양을 또 바꾸면 **옛 모양을 지우지 말고 더할 것** — 이미 나간 글은 옛 모양으로 ClassNote에 남아 있다.
 */
export const REPORT_LINE_LABEL = "보고서 : ";
export const VIDEO_LINE_LABEL = "영상첨부 : ";
/** 10-01 ~ 10-02에 나간 글의 둘째 줄 이름 — 알아보는 데만 쓴다(새 글은 위 이름으로 나간다). */
const LEGACY_VIDEO_LABEL = "영상 제출:";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 게시 본문 — 제출 주소가 없으면 공유 링크 한 줄(지금까지와 글자까지 같다). 있으면 두 줄에 이름을 단다. */
export function reportPostContent(shareUrl, videoUrl) {
  return videoUrl ? `${REPORT_LINE_LABEL}${shareUrl}\n${VIDEO_LINE_LABEL}${videoUrl}` : shareUrl;
}

/** 둘째 줄 앞의 줄 구분 — ClassNote가 저장하며 바꿀 수 있는 모양(`\r\n`·`<br>`·앞뒤 공백)을 받아 준다. */
// (빈칸을 반복 **밖**에 둔다 — 안팎에 겹쳐 두면 빈 줄이 여러 개인 글에서 되짚기가 폭발한다.)
const LINE_SEP = String.raw`[ \t]*(?:(?:\r?\n|<br\s*/?>)[ \t]*)+`;
// 둘째 줄의 주소 — `…/v/{토큰}`(학생마다 링크, 10-01 ~ 10-03) 또는 `…/v`(올리기 사이트 안내, 10-03 ~). 그 밖의 꼬리는 우리 글이 아니다.
const VIDEO_TAIL = String.raw`\s*https?://[^\s/<]+(?:/[^\s<]*)?/v(?:/[A-Za-z0-9_-]{43})?\s*$`;
/** 이름과 쌍점 사이·뒤의 빈칸 — ClassNote가 줄이거나 nbsp(`&nbsp;` 포함)로 바꿔 저장해도 알아본다. */
const GAP = String.raw`(?:[ \t ]|&nbsp;)*`;
const labelRe = (label) => `${escapeRe(label.split(":")[0].trim())}${GAP}:${GAP}`;

/**
 * 이 ClassNote 글이 그 공유 링크의 보고서 글인가 — 한 줄(링크만) 또는 영상 줄이 붙은 두 모양.
 * 실측(2026-10-02, 테스트 학생 '학원이'·테스트반): 두 줄 본문은 ClassNote에 **보낸 글자 그대로**(줄바꿈 `\n`) 저장된다.
 * 그래도 줄 구분·빈칸은 너그럽게 둔다(못 알아보면 재시도가 같은 글을 또 올린다) — 공유 링크는 **그대로**,
 * 둘째 줄 = 영상 주소 하나뿐이라는 점은 엄격하다(남의 글을 우리 글로 보지 않게).
 */
export function sameReportContent(content, shareUrl) {
  if (typeof content !== "string" || typeof shareUrl !== "string" || !shareUrl) return false;
  if (content === shareUrl) return true;
  const share = escapeRe(shareUrl);
  // ③ 10-02 모양 — 두 줄 모두 이름이 붙는다.
  if (new RegExp(`^\\s*${labelRe(REPORT_LINE_LABEL)}${share}${LINE_SEP}${labelRe(VIDEO_LINE_LABEL)}${VIDEO_TAIL}`).test(content)) return true;
  // ② 10-01 모양 — 첫 줄은 링크 그대로, 둘째 줄만 이름이 붙는다.
  return new RegExp(`^${share}${LINE_SEP}${escapeRe(LEGACY_VIDEO_LABEL)}${VIDEO_TAIL}`).test(content);
}

/**
 * 앱에 이 보고서 글의 영상 줄을 묻는다 → `{shareBase}/v`(올리기 사이트 안내 — 앱이 `site: true`) · `{shareBase}/v/{토큰}`(옛 앱)
 * · null(붙이지 않음·실패·앱이 아직 모름). 10초 안에 못 받으면 줄 없이 보낸다. 시크릿이 없으면 묻지도 않는다.
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
    if (data?.site === true) return `${String(shareBase).replace(/\/+$/, "")}/v`;
    const token = data?.token;
    return typeof token === "string" && TOKEN_RE.test(token) ? `${String(shareBase).replace(/\/+$/, "")}/v/${token}` : null;
  } catch {
    return null;
  }
}
