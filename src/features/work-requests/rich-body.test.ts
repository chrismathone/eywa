import { describe, expect, it } from "vitest";
import { sanitizeRichHtml } from "@/lib/html/sanitize";
import { bullets, esc, heading, isRichBody, looksLikeHtml, para, richBodyText, strong, textToRichBody, toRichBody, trimRichBody } from "./rich-body";

describe("업무 요청 내용 서식", () => {
  it("글자는 모두 이스케이프한다(이름 · 반 이름에 꺾쇠가 있어도 태그가 되지 않는다)", () => {
    expect(esc(`<script>"a" & b</script>`)).toBe("&lt;script&gt;&quot;a&quot; &amp; b&lt;/script&gt;");
    expect(strong("<b>")).toBe("<strong>&lt;b&gt;</strong>");
    expect(heading("가 & 나")).toBe("<h3>가 &amp; 나</h3>");
  });
  it("서식 글 판정 — 에디터 · 미리 채움 HTML만, 옛 글자만 있는 글은 아니다", () => {
    expect(isRichBody("<p>가</p>")).toBe(true);
    expect(isRichBody("  <h3>가</h3><ul><li>나</li></ul>")).toBe(true);
    expect(isRichBody("- 학생 가 — 결석 3회")).toBe(false);
    expect(isRichBody("<학생> 결석")).toBe(false);
  });
  it("글자만 있는 글은 문단 · 목록으로 바꿔 에디터에 넣는다", () => {
    expect(textToRichBody("머리\n\n- 가\n- 나 <b>\n끝")).toBe("<p>머리</p><ul><li>가</li><li>나 &lt;b&gt;</li></ul><p>끝</p>");
    expect(toRichBody("")).toBe("");
    expect(toRichBody("<p>그대로</p>")).toBe("<p>그대로</p>");
  });
  it("저장 — 끝의 빈 문단은 떼고, 태그로 시작하면 구분선이어도 HTML로 본다", () => {
    expect(trimRichBody("<p>가</p><ul><li><p>나</p></li></ul><p></p>")).toBe("<p>가</p><ul><li><p>나</p></li></ul>");
    expect(trimRichBody("<p>가</p><p><br></p><p></p>")).toBe("<p>가</p>");
    expect(trimRichBody("<p>가</p><p></p><p>다</p>")).toBe("<p>가</p><p></p><p>다</p>");
    expect(looksLikeHtml("<hr><p>가</p>")).toBe(true);
    expect(isRichBody("<hr><p>가</p>")).toBe(true);
    expect(looksLikeHtml("가 <b>")).toBe(false);
    // 구분선은 전자결재와 같은 허용 목록이라 저장 때 떨어진다(글은 남는다).
    expect(trimRichBody(sanitizeRichHtml("<hr><p>가</p><p></p>"))).toBe("<p>가</p>");
  });
  it("서식 글의 글자만 — 빈 서식(<p></p>)은 빈 글", () => {
    expect(richBodyText("<p>가 &amp; 나</p><ul><li><p>다</p></li></ul>")).toBe("가 & 나 다");
    expect(richBodyText("<p></p>")).toBe("");
  });
  it("미리 채운 글과 에디터가 다시 쓴 글은 같은 글자(아직 안 고쳤나 판정)", () => {
    const prefill = "<p>첫 문장</p><h3>강사 가 선생님 · 1명</h3><ul><li><strong>학생 사</strong> A중2<ul><li>결석 2회</li></ul></li></ul>";
    const editor = "<p>첫 문장</p><h3>강사 가 선생님 · 1명</h3><ul><li><p><strong>학생 사</strong> A중2</p><ul><li><p>결석 2회</p></li></ul></li></ul><p></p>";
    expect(richBodyText(prefill)).toBe("첫 문장 강사 가 선생님 · 1명 학생 사 A중2 결석 2회");
    expect(richBodyText(editor)).toBe(richBodyText(prefill));
  });
  it("미리 채운 서식은 저장 전 거르기를 그대로 지난다(태그가 떨어지지 않는다)", () => {
    const body = para(`${esc("겹친 학생 ")}${strong("3명")}`) + heading("강사 가 선생님 · 1명") + bullets([`${strong("학생 <가>")} A중2<ul><li>${esc("결석 2회 · 중2 수학 A 10/26")}</li></ul>`]);
    expect(sanitizeRichHtml(body)).toBe(body);
  });
});
