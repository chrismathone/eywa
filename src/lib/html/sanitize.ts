import sanitizeHtml from "sanitize-html";

/**
 * 리치 텍스트(에디터가 만든 HTML) 위생처리 — **저장 직전 서버에서** 반드시 한 번 거친다.
 *
 * 🔴 왜 필요한가: 결재 문서 본문은 사람이 쓴 HTML을 **그대로 렌더**한다(`dangerouslySetInnerHTML`).
 *    걸러내지 않으면 기안자가 `<script>`나 `onerror=` 한 줄로 **그 문서를 여는 결재자·원장의 세션에서**
 *    코드를 돌릴 수 있다(저장형 XSS). 결재 문서는 정의상 "남이 반드시 여는 글"이라 위험이 크다.
 *
 * 🔑 판정 원칙 = **허용 목록**(allowlist). "위험한 걸 지운다"가 아니라 "아는 것만 남긴다" —
 *    새로운 우회 문법(`<svg onload>`·`<math>`…)이 나와도 목록에 없으면 자동으로 떨어진다.
 *
 * ⚠️ `style`·`class`는 **통째로 금지**한다. 색·크기를 인라인으로 허용하면 문서마다 서식이 제각각이 되고
 *    (`position:fixed`로 화면을 덮는 장난도 가능하다), 우리 문서 서식은 `.rich-content`(globals.css)가
 *    한 곳에서 정한다. 대가: 에디터에서 조절한 **표 열 너비(colwidth)는 저장되지 않는다** — 열은 균등
 *    분배로 렌더된다(서식 일관성을 택했다).
 * ⚠️ 링크는 `http`·`https`·`mailto`만. `javascript:`·`data:`는 스킴 단계에서 잘린다.
 * ⚠️ **서버 전용으로 쓸 것**(서버 액션에서 저장 전에 호출). 클라 번들에 끌어들이면 파서가 함께 실린다 —
 *    화면 렌더는 이미 위생처리된 값을 그리므로 클라에서 다시 부를 일이 없다.
 *    (`import "server-only"`은 일부러 안 붙였다 — 스크립트·테스트에서도 부를 수 있게, [[#61]].)
 */

/** 문서 본문에 남길 태그. 여기 없는 태그는 **내용만 남기고 태그가 제거**된다. */
const ALLOWED_TAGS = [
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "ul",
  "ol",
  "li",
  "a",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "code",
  "pre",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "colgroup",
  "col",
  "span",
  "div",
] as const;

/**
 * 위생처리된 HTML을 돌려준다. 빈 입력·비문자열은 빈 문자열.
 *
 * 멱등이다 — 이미 통과한 HTML을 다시 넣어도 같은 결과(재저장·마이그레이션에서 여러 번 거쳐도 안전).
 */
export function sanitizeRichHtml(html: string | null | undefined): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href"],
      // 표 병합은 구조 정보라 남긴다(숫자 속성이고 스크립트가 실릴 자리가 없다).
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesAppliedToAttributes: ["href"],
    // 목록에 없는 태그는 **버린다**(태그만 벗기고 글자는 살린다 — 사용자가 쓴 문장이 사라지지 않게).
    disallowedTagsMode: "discard",
    // script/style/textarea/option은 **내용까지** 통째로 버린다(기본값을 명시로 고정).
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
    // 프로토콜 없는 상대 링크(`/foo`)는 허용하지 않는다 — 문서 본문에서 앱 내부 경로를 위장할 이유가 없다.
    allowProtocolRelative: false,
  });
}
