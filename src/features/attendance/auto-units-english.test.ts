import { describe, expect, it } from "vitest";
import { unitsFromMinutes } from "./auto-units";

describe("영어 트랙 시수", () => {
  it("EiE는 40분당 1시수로 계산한다", () => {
    expect(unitsFromMinutes(40, "eie")).toBeNull();
    expect(unitsFromMinutes(60, "eie")).toBe(1.5);
    expect(unitsFromMinutes(80, "eie")).toBe(2);
    expect(unitsFromMinutes(120, "eie")).toBe(3);
  });

  it("인재원은 60분당 0.5시수를 유지한다", () => {
    expect(unitsFromMinutes(60, "injaewon")).toBe(0.5);
    expect(unitsFromMinutes(120, "injaewon")).toBeNull();
    expect(unitsFromMinutes(180, "injaewon")).toBe(1.5);
  });
});
