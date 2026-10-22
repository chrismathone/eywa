import { describe, it, expect } from "vitest";
import { courseDuration } from "./course-period";
describe("calendar course duration", () => {
  it.each([
    ["2026-10-07", "2026-10-22", "0개월, 15일"],
    ["2026-01-31", "2026-02-28", "1개월, 0일"],
    ["2024-01-31", "2024-02-29", "1개월, 0일"],
    ["2026-01-31", "2026-03-01", "1개월, 1일"],
    ["2025-03-01", "2026-10-22", "19개월, 21일"],
    ["2026-10-22", "2026-10-22", "0개월, 0일"],
    ["2026-10-23", "2026-10-22", "기간 확인 필요"],
    ["2026-02-30", "2026-10-22", "기간 확인 필요"],
  ])("%s to %s → %s", (from, to, expected) => expect(courseDuration(from, to)).toBe(expected));
});
