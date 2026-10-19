import { describe, expect, it } from "vitest";
import { canShiftCell } from "./shift-visible";

const line = (o: Partial<Parameters<typeof canShiftCell>[0][number]> = {}) => ({
  termMode: "regular",
  textbook: null,
  pageRange: null,
  progress: null,
  homework: null,
  ...o,
});

describe("canShiftCell — 계획만 있으면 버튼 숨김(원장 2026-10-19)", () => {
  it("실제 줄이 없으면 안 세운다", () => {
    expect(canShiftCell([])).toBe(false);
  });
  it("구분만 고른 빈 줄은 없는 것과 같다", () => {
    expect(canShiftCell([line()])).toBe(false);
  });
  it("내신 줄만 있으면 안 세운다(버튼은 평시 축)", () => {
    expect(canShiftCell([line({ termMode: "exam", progress: "Unit 1" })])).toBe(false);
  });
  it("평시에 뭔가 적혀 있으면 세운다", () => {
    expect(canShiftCell([line({ textbook: "SKY" })])).toBe(true);
    expect(canShiftCell([line({ progress: "Unit 1" })])).toBe(true);
  });
});
