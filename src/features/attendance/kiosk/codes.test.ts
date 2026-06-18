import { describe, expect, it } from "vitest";
import { assignAttendanceCode, isValidCodeInput, last4 } from "./codes";

describe("last4", () => {
  it("뒤 4자리 추출", () => {
    expect(last4("010-1234-5678")).toBe("5678");
    expect(last4("01012345678")).toBe("5678");
    expect(last4("010 1234 5678")).toBe("5678");
    expect(last4("+82 10-1234-5678")).toBe("5678");
  });
  it("4자리 미만/빈값은 null", () => {
    expect(last4("123")).toBeNull();
    expect(last4("")).toBeNull();
    expect(last4(null)).toBeNull();
    expect(last4(undefined)).toBeNull();
    expect(last4("--")).toBeNull();
  });
});

describe("assignAttendanceCode", () => {
  it("학생 본인 휴대폰 뒷4자리 우선", () => {
    const code = assignAttendanceCode({
      studentPhone: "010-1111-2222",
      parentPhone: "010-9999-8888",
      takenCodes: new Set(),
    });
    expect(code).toBe("2222");
  });

  it("학생 휴대폰 없으면 학부모 뒷4자리로 폴백", () => {
    const code = assignAttendanceCode({
      studentPhone: null,
      parentPhone: "010-9999-8888",
      takenCodes: new Set(),
    });
    expect(code).toBe("8888");
  });

  it("둘 다 없으면 null(발급 스킵)", () => {
    expect(
      assignAttendanceCode({ studentPhone: null, parentPhone: null, takenCodes: new Set() }),
    ).toBeNull();
    expect(
      assignAttendanceCode({ studentPhone: "12", parentPhone: "9", takenCodes: new Set() }),
    ).toBeNull();
  });

  it("형제(동일 학부모 번호) 충돌 시 5자리로 분기", () => {
    const taken = new Set<string>();
    const first = assignAttendanceCode({ studentPhone: null, parentPhone: "010-0000-1234", takenCodes: taken });
    expect(first).toBe("1234");
    taken.add(first!);
    const second = assignAttendanceCode({ studentPhone: null, parentPhone: "010-0000-1234", takenCodes: taken });
    expect(second).toBe("12340");
    taken.add(second!);
    const third = assignAttendanceCode({ studentPhone: null, parentPhone: "010-0000-1234", takenCodes: taken });
    expect(third).toBe("12341");
  });

  it("비형제라도 뒷4자리 우연 일치 시 5자리 분기(결정적 순서)", () => {
    const taken = new Set<string>(["5678"]);
    const code = assignAttendanceCode({ studentPhone: "010-1234-5678", parentPhone: null, takenCodes: taken });
    expect(code).toBe("56780");
  });

  it("동일 뒷4자리 11건+ 면 throw", () => {
    const taken = new Set<string>(["1234"]);
    for (let i = 0; i <= 9; i++) taken.add(`1234${i}`);
    expect(() =>
      assignAttendanceCode({ studentPhone: null, parentPhone: "010-0000-1234", takenCodes: taken }),
    ).toThrow(/공간 소진/);
  });
});

describe("isValidCodeInput", () => {
  it("4 또는 5자리 숫자만 허용", () => {
    expect(isValidCodeInput("1234")).toBe(true);
    expect(isValidCodeInput("12345")).toBe(true);
    expect(isValidCodeInput("123")).toBe(false);
    expect(isValidCodeInput("123456")).toBe(false);
    expect(isValidCodeInput("12a4")).toBe(false);
    expect(isValidCodeInput("")).toBe(false);
  });
});
