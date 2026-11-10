import { describe, expect, it } from "vitest";
import { FIXED_MAX, FLEX_MIN, fitColumn, mayOverflow, oneLine, tableMinWidth } from "./report-columns";

describe("보고서 표 열 폭", () => {
  it("짧은 열은 가장 긴 값에 맞춘 고정 폭", () => {
    const fit = fitColumn("학년", ["중1", "초4", "중3"]);
    expect(fit.width).not.toBeNull();
    expect(fit.width!).toBeLessThanOrEqual(FIXED_MAX);
  });
  it("긴 글 열(메모)은 고정하지 않고 남은 폭을 쓴다", () => {
    expect(fitColumn("퇴원 메모", ["학생이 학원을 그만두는 이유를 길게 적은 메모입니다 담임이 바뀌어서 그렇다고 합니다"]).width).toBeNull();
  });
  it("표 최소 폭 = 고정 합 + 긴 글 열 최소 폭", () => {
    expect(tableMinWidth([{ width: 80 }, { width: null }])).toBe(80 + FLEX_MIN);
  });
  it("줄바꿈은 한 줄로 잇고, 넘칠 수 있는 칸만 카드를 단다", () => {
    expect(oneLine("첫 줄\n\n둘째 줄")).toBe("첫 줄 · 둘째 줄");
    expect(mayOverflow("짧음", { width: 80 })).toBe(false);
    expect(mayOverflow("가\n나", { width: 80 })).toBe(true);
    expect(mayOverflow("긴 메모가 이어집니다 긴 메모가 이어집니다 긴 메모", { width: null })).toBe(true);
  });
});
