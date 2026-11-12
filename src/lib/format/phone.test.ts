import { describe, expect, it } from "vitest";
import { phoneLabel } from "./phone";

describe("phoneLabel", () => {
  it("숫자만 적힌 휴대폰에 하이픈을 넣는다", () => {
    expect(phoneLabel("01058782882")).toBe("010-5878-2882");
    expect(phoneLabel("0111234567")).toBe("011-123-4567");
    expect(phoneLabel("1058782882")).toBe("010-5878-2882");
  });
  it("점·공백·괄호 구분도 하이픈으로", () => {
    expect(phoneLabel("010.5878.2882")).toBe("010-5878-2882");
    expect(phoneLabel(" 010 5878 2882 ")).toBe("010-5878-2882");
    expect(phoneLabel("(053)123-4567")).toBe("053-123-4567");
    expect(phoneLabel("+82 10-5878-2882")).toBe("010-5878-2882");
  });
  it("지역번호·대표번호·안심번호", () => {
    expect(phoneLabel("0212345678")).toBe("02-1234-5678");
    expect(phoneLabel("021234567")).toBe("02-123-4567");
    expect(phoneLabel("0531234567")).toBe("053-123-4567");
    expect(phoneLabel("07012345678")).toBe("070-1234-5678");
    expect(phoneLabel("15881234")).toBe("1588-1234");
    expect(phoneLabel("050512345678")).toBe("0505-1234-5678");
  });
  it("이미 하이픈이 있으면 같은 값", () => {
    expect(phoneLabel("010-5878-2882")).toBe("010-5878-2882");
  });
  it("모양을 모르는 값은 그대로", () => {
    expect(phoneLabel("김초롱")).toBe("김초롱");
    expect(phoneLabel("010-1234-5678 / 010-2222-3333")).toBe("010-1234-5678 / 010-2222-3333");
    expect(phoneLabel("12345")).toBe("12345");
    expect(phoneLabel("+1 415 555 0100")).toBe("+1 415 555 0100");
    expect(phoneLabel("333D32100E3D115B")).toBe("333D32100E3D115B");
  });
  it("빈 값은 null", () => {
    expect(phoneLabel(null)).toBeNull();
    expect(phoneLabel(undefined)).toBeNull();
    expect(phoneLabel("  ")).toBeNull();
  });
});
