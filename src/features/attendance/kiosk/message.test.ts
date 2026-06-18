import { describe, expect, it } from "vitest";
import { buildAttendanceMessage, maskName, maskPhone } from "./message";

describe("maskName", () => {
  it("가운데 글자 마스킹", () => {
    expect(maskName("김철수")).toBe("김○수");
    expect(maskName("남궁민수")).toBe("남○○수");
  });
  it("2글자는 끝 글자만 가림, 1글자는 그대로", () => {
    expect(maskName("이수")).toBe("이○");
    expect(maskName("강")).toBe("강");
    expect(maskName("")).toBe("");
  });
});

describe("maskPhone", () => {
  it("가운데 4자리 마스킹", () => {
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskPhone("01012345678")).toBe("010-****-5678");
  });
  it("빈값/짧은 번호 안전 처리", () => {
    expect(maskPhone(null)).toBe("");
    expect(maskPhone("")).toBe("");
    expect(maskPhone("123")).toBe("***");
  });
});

describe("buildAttendanceMessage", () => {
  it("등원 정보성 문구", () => {
    expect(
      buildAttendanceMessage({ studentName: "김철수", kind: "checkin", time: "16:05", academyName: "인재원" }),
    ).toBe("[인재원] 김철수 학생이 16:05에 등원하였습니다.");
  });
  it("하원 정보성 문구", () => {
    expect(
      buildAttendanceMessage({ studentName: "이영희", kind: "checkout", time: "18:30", academyName: "인재원" }),
    ).toBe("[인재원] 이영희 학생이 18:30에 하원하였습니다.");
  });
  it("학원명 비면 기본값", () => {
    expect(
      buildAttendanceMessage({ studentName: "박민", kind: "checkin", time: "09:00", academyName: "" }),
    ).toContain("[학원]");
  });
});
