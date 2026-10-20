import { describe, expect, it } from "vitest";
import { planMakeeduCarry } from "./makeedu-carry";

describe("병합 때 메이크에듀 원생 번호", () => {
  it("남는 쪽이 비어 있으면 진 쪽 번호를 옮긴다(권민서A ← 권민서B 14122)", () => {
    expect(planMakeeduCarry(null, "14122")).toEqual({ kind: "move", makeeduId: "14122" });
    expect(planMakeeduCarry("  ", "14122")).toEqual({ kind: "move", makeeduId: "14122" });
  });
  it("진 쪽에 번호가 없거나 같은 번호면 할 일이 없다", () => {
    expect(planMakeeduCarry("1", null)).toEqual({ kind: "keep" });
    expect(planMakeeduCarry(null, null)).toEqual({ kind: "keep" });
    expect(planMakeeduCarry("7", "7")).toEqual({ kind: "keep" });
  });
  it("둘 다 다른 번호면 옮기지 않고 알린다(메이크에듀에서도 두 원생)", () => {
    expect(planMakeeduCarry("1", "2")).toEqual({ kind: "conflict", mergeeMakeeduId: "2" });
  });
});
