import { describe, expect, it } from "vitest";
import { makeupShift, minutesLabel } from "./rider-day-check";

describe("makeupShift — 보강이 얼마나 옮겨졌나", () => {
  it("날짜 차이와 시작 시각 차이", () => {
    expect(makeupShift("2026-10-28", "16:00", "2026-10-30", "18:00")).toEqual({ days: 2, startMin: 120 });
    expect(makeupShift("2026-10-28", null, "2026-10-28", "18:00")).toEqual({ days: 0, startMin: null });
  });
  it("minutesLabel", () => {
    expect(minutesLabel(130)).toBe("2시간 10분");
    expect(minutesLabel(-40)).toBe("40분");
    expect(minutesLabel(120)).toBe("2시간");
  });
});
