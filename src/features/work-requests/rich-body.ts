/**
 * 업무 요청 '내용' 서식 — 전자결재와 같은 리치 텍스트(TipTap HTML · 보이는 서식은 `.rich-content` 한 벌)로 담는다
 * (원장 2026-11-02 *"담임에게 전달할 내용이 너무 두서없이 나열 … 노션처럼 약간의 서식을 넣을 수 있게"*).
 * 미리 채우는 글은 여기 도우미로 HTML을 짓는다 — 글자는 모두 이스케이프한다.
 * 🔴 저장 전 · 읽을 때 서버가 `sanitizeRichHtml`로 한 번 더 거른다(여기는 게이트가 아니다 — #77).
 * 옛 요청(글자만)은 그대로 둔다 — `isRichBody`가 아니면 글자로 그린다. 순수 함수(Vitest · 화면에서도 쓴다 — sanitize-html을 끌어오지 않는다).
 */

/** 저장 한도(서식 포함 글자 수) — DB 검사(s2_0018 `work_requests.body`)와 같은 값. */
export const BODY_LIMIT = 20_000;
/** 미리 채울 때 쓰는 한도 — 고칠 자리를 남긴다(에디터는 목록 줄마다 문단 태그를 더한다). */
export const PREFILL_BUDGET = 15_000;

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const strong = (s: string) => `<strong>${esc(s)}</strong>`;
/** 문단 — `html`은 이미 이스케이프한 조각이다(`esc` · `strong`으로 지은 것). */
export const para = (html: string) => `<p>${html}</p>`;
export const heading = (s: string) => `<h3>${esc(s)}</h3>`;
/** 목록 — 항목은 이미 이스케이프한 조각이다. */
export const bullets = (items: readonly string[]) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");

/** 서식 글인가(에디터 · 미리 채움이 만든 HTML). 옛 요청은 글자만이다. */
export const isRichBody = (body: string) => /^\s*<(p|h[1-6]|ul|ol|table|blockquote|pre|hr|div)[\s>/]/i.test(body);
/** 저장할 때 HTML로 볼 글 — 태그로 시작하면 모두(판정이 빠져 거르지 않고 저장되는 일이 없게 — 에디터는 늘 HTML을 낸다). */
export const looksLikeHtml = (body: string) => /^\s*</.test(body);

/** 끝의 빈 문단을 뗀다 — 에디터가 글 끝에 늘 빈 문단을 하나 붙인다(보기에서 빈 줄이 남지 않게). */
export const trimRichBody = (html: string) => html.replace(/(?:<p>\s*(?:<br\s*\/?>)?\s*<\/p>\s*)+$/i, "");

/** 글자만 있는 글 → 서식 글 — '- '로 시작하는 줄은 목록, 나머지 줄은 문단(빈 줄은 문단 사이). */
export function textToRichBody(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(bullets(list)); list = []; } };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const item = /^[-•]\s+(.*)$/.exec(line);
    if (item) list.push(esc(item[1]!));
    else { flush(); out.push(para(esc(line))); }
  }
  flush();
  return out.join("");
}

/** 에디터에 넣을 값 — 서식 글은 그대로, 글자만 있는 글은 문단 · 목록으로. */
export const toRichBody = (body: string) => (!body.trim() ? "" : isRichBody(body) ? body : textToRichBody(body));

/**
 * 서식 글의 글자만(빈 글 · 펼치기 · 제목 글자 · 아직 안 고쳤나 판정). 블록 태그는 여닫이 모두 띄어 쓴다 —
 * 에디터가 목록 줄을 문단으로 감싸도(`<li><p>…</p></li>`) 미리 채운 글(`<li>…<ul>`)과 같은 글자가 나온다.
 */
export function richBodyText(html: string): string {
  return html
    .replace(/<\/?(p|h[1-6]|li|ul|ol|tr|td|th|blockquote|pre|div|br|hr)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
