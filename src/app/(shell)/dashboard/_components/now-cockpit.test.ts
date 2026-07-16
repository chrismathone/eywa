import { describe, expect, it } from "vitest";
import { densityAxisLabels, densityMarkerPercent } from "./now-cockpit";

const SLOTS = [
  { startTime: "09:00:00", endTime: "10:00:00" },
  { startTime: "15:00:00", endTime: "16:00:00" },
];

describe("densityMarkerPercent", () => {
  it("수업 사이 공백에서도 실제 KST 시각 위치를 사용한다", () => {
    const atNoon = densityMarkerPercent(SLOTS, 12 * 60);
    const atThree = densityMarkerPercent(SLOTS, 15 * 60);

    expect(atNoon).not.toBeNull();
    expect(atThree).not.toBeNull();
    expect(atNoon!).toBeLessThan(atThree!);
  });

  it("첫 수업 전과 마지막 수업 후에는 지금 마커를 숨긴다", () => {
    expect(densityMarkerPercent(SLOTS, 8 * 60 + 59)).toBeNull();
    expect(densityMarkerPercent(SLOTS, 16 * 60 + 1)).toBeNull();
  });

  it("첫 시작과 마지막 종료는 축의 0%와 100%에 정확히 놓인다", () => {
    expect(densityMarkerPercent(SLOTS, 9 * 60)).toBe(0);
    expect(densityMarkerPercent(SLOTS, 16 * 60)).toBe(100);
  });

  it("30분 경계의 실제 시작·종료 시각을 축 라벨로 보존한다", () => {
    expect(
      densityAxisLabels([{ startTime: "09:30:00", endTime: "10:30:00" }]),
    ).toEqual({ start: "9:30", end: "10:30" });
  });
});
