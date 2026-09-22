import { describe, it, expect } from "vitest";
import { sanitizeRichHtml } from "./sanitize";

describe("스크립트 실행 경로 차단", () => {
  it("script 태그는 내용까지 통째로 사라진다", () => {
    const out = sanitizeRichHtml('<p>안녕</p><script>alert(1)</script>');
    expect(out).toBe("<p>안녕</p>");
    expect(out).not.toContain("alert");
  });

  it("이벤트 핸들러 속성(onerror·onclick)은 제거된다", () => {
    expect(sanitizeRichHtml('<p onclick="steal()">본문</p>')).toBe("<p>본문</p>");
    // img는 허용 태그가 아니라 태그 자체가 사라진다(onerror가 남을 자리도 없다).
    expect(sanitizeRichHtml('<img src=x onerror="alert(1)">')).not.toContain("onerror");
  });

  it("javascript: 링크는 href가 잘린다", () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">클릭</a>');
    expect(out).not.toContain("javascript");
    expect(out).toContain("클릭"); // 글자는 살린다
  });

  it("data: URL 링크도 막는다", () => {
    expect(sanitizeRichHtml('<a href="data:text/html,<script>x</script>">x</a>')).not.toContain(
      "data:",
    );
  });

  it("iframe·object·style·meta는 남지 않는다", () => {
    const dirty =
      '<iframe src="https://evil.test"></iframe><object data="x"></object>' +
      "<style>body{display:none}</style><meta http-equiv=refresh content=0>";
    const out = sanitizeRichHtml(dirty);
    expect(out).not.toMatch(/iframe|object|<style|meta/i);
  });
});

describe("서식·구조 보존", () => {
  it("굵게·기울임·밑줄·취소선은 살아남는다", () => {
    const html = "<p><strong>굵게</strong><em>기울임</em><u>밑줄</u><s>취소</s></p>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("목록과 중첩 태그가 보존된다", () => {
    const html = "<ul><li><strong>가</strong>나</li><li>다</li></ul>";
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("표는 병합 속성(colspan·rowspan)까지 보존된다", () => {
    const html =
      '<table><tbody><tr><th colspan="2">머리</th></tr><tr><td rowspan="2">본문</td><td>옆</td></tr></tbody></table>';
    const out = sanitizeRichHtml(html);
    expect(out).toContain('colspan="2"');
    expect(out).toContain('rowspan="2"');
    expect(out).toContain("<table>");
  });

  it("정상 링크(http·https·mailto)는 유지된다", () => {
    expect(sanitizeRichHtml('<a href="https://aywa.test/x">링크</a>')).toContain(
      'href="https://aywa.test/x"',
    );
    expect(sanitizeRichHtml('<a href="mailto:a@b.com">메일</a>')).toContain("mailto:a@b.com");
  });
});

describe("서식 일관성 — style·class는 통째로 금지", () => {
  it("style 속성은 제거된다(표 열 너비도 함께 — 문서 서식은 .rich-content가 정한다)", () => {
    const out = sanitizeRichHtml('<p style="position:fixed;color:red">글</p>');
    expect(out).toBe("<p>글</p>");
  });

  it("class 속성도 제거된다", () => {
    expect(sanitizeRichHtml('<div class="evil">x</div>')).toBe("<div>x</div>");
  });
});

describe("입력 방어와 멱등", () => {
  it("빈 값·null·undefined는 빈 문자열", () => {
    expect(sanitizeRichHtml("")).toBe("");
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
  });

  it("이미 통과한 HTML을 다시 넣어도 같은 결과(멱등)", () => {
    const once = sanitizeRichHtml('<p onclick="x()">가<a href="javascript:1">나</a></p>');
    expect(sanitizeRichHtml(once)).toBe(once);
  });
});
