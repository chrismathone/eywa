import { describe, expect, it } from "vitest";

import { hasPastedMarkup, stripPastedMarkup } from "./paste-cleanup";

// 실데이터(2026-09-09, 정하운 상담) 그대로 — 한 줄짜리 DOM 조각이 문장 사이에 끼어 있었다.
const REAL_JUNK =
  '*]:pointer-events-auto scroll-mt-[calc(var(--header-height)+min(200px,max(70px,20svh)))]" tabindex="-1" ' +
  'dir="auto" data-turn-id="request-WEB:3f1776a5-6073-48b0-a350-69ed8bd9e4d9-4" data-testid="conversation-turn-10" ' +
  'data-scroll-anchor="true" data-turn="assistant">';

describe("붙여넣기 화면 코드 조각 걷어내기", () => {
  it("실데이터의 조각 줄만 지우고 상담 내용은 그대로 둔다", () => {
    const input = ["[학생 상담일지2026년 03월 04일]", "혼합 계산 어려워함.", REAL_JUNK, "낯가림 있음.", "", "[등록자: 권나현]"].join("\n");
    expect(stripPastedMarkup(input)).toBe(
      ["[학생 상담일지2026년 03월 04일]", "혼합 계산 어려워함.", "낯가림 있음.", "", "[등록자: 권나현]"].join("\n"),
    );
  });

  it("조각 뒤에 붙은 사람 글은 살린다(통째로 지우면 상담 내용이 사라진다)", () => {
    expect(stripPastedMarkup(`${REAL_JUNK}안다고 하면서 스스로 풀려는 경향 강함.`)).toBe(
      "안다고 하면서 스스로 풀려는 경향 강함.",
    );
  });

  it("잡음이 없으면 원문 그대로 — 공백·줄바꿈도 안 건드린다", () => {
    const clean = "학부모 상담\n\n  진도 문의.  \n";
    expect(stripPastedMarkup(clean)).toBe(clean);
  });

  it("한글 문장은 부등호가 있어도 안 건드린다", () => {
    const text = "정답률 x < 3 인 경우 재시험. 2 > 1 이라고 설명함.";
    expect(stripPastedMarkup(text)).toBe(text);
    expect(hasPastedMarkup(text)).toBe(false);
  });

  it("한글이 없고 속성 쌍이 여럿인 줄은 표식이 없어도 지운다", () => {
    const input = ['<div id="root" role="main">', "상담 진행함."].join("\n");
    expect(stripPastedMarkup(input)).toBe("상담 진행함.");
  });

  it("닫는 태그가 없고 한글이 있으면 표식이 있어도 그대로 둔다(본문을 먹지 않는다)", () => {
    const keep = '학부모가 dir="auto" 라고 적어 보냄.';
    expect(stripPastedMarkup(keep)).toBe(keep);
    const plain = "학부모가 style 이야기를 함.";
    expect(stripPastedMarkup(plain)).toBe(plain);
  });

  it("닫는 태그가 없어도 한글이 없는 속성 줄은 지운다", () => {
    const input = ['tabindex="-1" dir="auto" data-turn="assistant"', "상담 진행함."].join("\n");
    expect(stripPastedMarkup(input)).toBe("상담 진행함.");
  });

  it("CRLF 원문은 CRLF로 되돌린다", () => {
    const input = `가나다\r\n${REAL_JUNK}\r\n라마바`;
    expect(stripPastedMarkup(input)).toBe("가나다\r\n라마바");
  });

  it("빈 값·null은 그대로", () => {
    expect(stripPastedMarkup(null)).toBeNull();
    expect(stripPastedMarkup(undefined)).toBeNull();
    expect(stripPastedMarkup("")).toBe("");
  });

  it("hasPastedMarkup은 실데이터 조각을 알아본다", () => {
    expect(hasPastedMarkup(REAL_JUNK)).toBe(true);
    expect(hasPastedMarkup("정상 상담 내용입니다.")).toBe(false);
  });
});
