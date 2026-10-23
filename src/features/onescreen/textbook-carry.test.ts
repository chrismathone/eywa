import { describe, expect, it } from "vitest";
import { stripTextbookPages } from "./textbook-carry";

describe("직전 교재를 가져올 때 쪽수만 뗀다", () => {
  it("실데이터 두 꼴", () => {
    expect(stripTextbookPages("개념원리 중2-1 16쪽~21쪽")).toBe("개념원리 중2-1");
    expect(stripTextbookPages("p133~p143")).toBe("");
  });
  it("쪽 단위가 붙은 다른 꼴", () => {
    expect(stripTextbookPages("쎈 2-2 42~48p")).toBe("쎈 2-2");
    expect(stripTextbookPages("쎈 2-2 p.42")).toBe("쎈 2-2");
    expect(stripTextbookPages("RPM 중1 50페이지")).toBe("RPM 중1");
    expect(stripTextbookPages("RPM 중1 50쪽-60쪽")).toBe("RPM 중1");
  });
  it("학년·권·단원 숫자는 손대지 않는다", () => {
    for (const t of ["개념원리 중2-1", "가우스 4-1-2", "가우스 중2-2-3권", "중 1-1-2", "2-2", "rpm 중2-2", "초5-2 발전 1권(22개정)", "3-2 바이블"]) {
      expect(stripTextbookPages(t)).toBe(t);
    }
  });
});
