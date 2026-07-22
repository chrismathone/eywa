import { describe, it, expect } from "vitest";
import { bulkPickLabel } from "./bulk-label";

describe("bulkPickLabel", () => {
  it("선택 수와 대상 수가 같으면 하나만 말한다", () => {
    expect(bulkPickLabel(37, 37)).toBe("선택 37");
    expect(bulkPickLabel(1, 1)).toBe("선택 1");
  });

  // 2026-07-21 회귀: 37행 선택인데 버튼이 "선택 0 저장"이라 0개 선택한 것처럼 보였다.
  it("대상이 0이어도 선택 수를 숨기지 않는다", () => {
    expect(bulkPickLabel(37, 0)).toBe("선택 37 중 0");
  });

  it("일부만 대상이면 둘 다 밝힌다", () => {
    expect(bulkPickLabel(37, 12)).toBe("선택 37 중 12");
  });

  it("선택 0이면 그대로 0", () => {
    expect(bulkPickLabel(0, 0)).toBe("선택 0");
  });
});
