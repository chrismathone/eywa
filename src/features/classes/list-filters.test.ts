import { describe, expect, it } from "vitest";
import { CLASS_STATUS_DEFAULT, parseClassStatus, STATUS_FILTERS, teacherTeaches } from "./list-filters";

describe("parseClassStatus (상태 필터 해석 — 서버·열 머리 단일 소스)", () => {
  it("미지정·모르는 값은 기본값 '운영'", () => {
    expect(CLASS_STATUS_DEFAULT).toBe("operating");
    expect(parseClassStatus(undefined)).toBe("operating");
    expect(parseClassStatus(null)).toBe("operating");
    expect(parseClassStatus("")).toBe("operating");
    expect(parseClassStatus("closed")).toBe("operating"); // 옛 축(active) 어휘도 안 받는다
  });

  it("아는 값은 그대로", () => {
    expect(parseClassStatus("all")).toBe("all");
    expect(parseClassStatus("ended")).toBe("ended");
    expect(parseClassStatus("retired")).toBe("retired");
  });

  it("선택지 라벨은 배지와 같은 말(운영·종강·폐지·전체)", () => {
    expect(STATUS_FILTERS.map((o) => o.label)).toEqual(["운영", "종강", "폐지", "전체"]);
  });
});

describe("teacherTeaches", () => {
  it("대소문자 편차에 견고", () => {
    expect(teacherTeaches(["MATH"], "math")).toBe(true);
    expect(teacherTeaches(["english"], "math")).toBe(false);
  });
});
