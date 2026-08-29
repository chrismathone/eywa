import { describe, expect, it } from "vitest";
import { sanitizeScoreInput } from "./score-input";

describe("sanitizeScoreInput — 등록상담 점수칸", () => {
  it("소수를 그대로 받는다(원장 제보: 67.5가 안 들어감)", () => {
    expect(sanitizeScoreInput("67.5")).toBe("67.5");
    expect(sanitizeScoreInput("55.93")).toBe("55.93");
    expect(sanitizeScoreInput("100.0")).toBe("100.0");
  });

  it("한 글자씩 치는 도중에도 소수점이 살아 있다", () => {
    // 옛 구현은 "67." 단계에서 점을 지워 "675"가 됐다.
    expect(sanitizeScoreInput("6")).toBe("6");
    expect(sanitizeScoreInput("67")).toBe("67");
    expect(sanitizeScoreInput("67.")).toBe("67.");
    expect(sanitizeScoreInput("67.5")).toBe("67.5");
  });

  it("기존 정수 값은 그대로 통과한다(하위 호환)", () => {
    expect(sanitizeScoreInput("69")).toBe("69");
    expect(sanitizeScoreInput("0")).toBe("0");
    expect(sanitizeScoreInput("100")).toBe("100");
  });

  it("정수부는 3자리, 소수부는 2자리로 자른다", () => {
    expect(sanitizeScoreInput("12345")).toBe("123");
    expect(sanitizeScoreInput("1234.5")).toBe("123.5");
    expect(sanitizeScoreInput("67.5678")).toBe("67.56");
  });

  it("소수점으로 시작하면 0을 채운다", () => {
    expect(sanitizeScoreInput(".")).toBe("0.");
    expect(sanitizeScoreInput(".5")).toBe("0.5");
  });

  it("소수점은 하나만 남긴다", () => {
    expect(sanitizeScoreInput("67..5")).toBe("67.5");
    expect(sanitizeScoreInput("6.7.5")).toBe("6.75");
  });

  it("숫자·소수점이 아닌 문자는 버린다", () => {
    expect(sanitizeScoreInput("67.5점")).toBe("67.5");
    expect(sanitizeScoreInput("-67.5")).toBe("67.5");
    expect(sanitizeScoreInput(" 6 7 ")).toBe("67");
    expect(sanitizeScoreInput("abc")).toBe("");
    expect(sanitizeScoreInput("")).toBe("");
  });

  it("붙여넣기처럼 한 번에 들어오는 값도 같은 규칙", () => {
    expect(sanitizeScoreInput("상위 55.93%")).toBe("55.93");
  });
});
