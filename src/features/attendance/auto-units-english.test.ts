import { describe, expect, it } from "vitest";
import { unitsFromMinutes } from "./auto-units";

describe("영어 트랙 시수", () => {
  it("EiE는 40분당 1시수로 계산한다", () => {
    expect(unitsFromMinutes(40, "eie")).toBeNull();
    expect(unitsFromMinutes(60, "eie")).toBe(1.5);
    expect(unitsFromMinutes(80, "eie")).toBe(2);
    expect(unitsFromMinutes(120, "eie")).toBe(3);
  });

  it("인재원은 60분당 1시수다(수학의 0.5와 구분)", () => {
    expect(unitsFromMinutes(60, "injaewon")).toBeNull();
    expect(unitsFromMinutes(120, "injaewon")).toBe(2);
    expect(unitsFromMinutes(180, "injaewon")).toBe(3);
    expect(unitsFromMinutes(60, "math")).toBe(0.5);
  });
});
