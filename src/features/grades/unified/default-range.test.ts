import { describe, expect, it } from "vitest";
import { defaultRangeFrom } from "./default-range";

describe("defaultRangeFrom — 최근 한 달", () => {
  it("한 달 전 같은 날", () => expect(defaultRangeFrom("2026-09-24")).toBe("2026-08-24"));
  it("1월은 전년 12월", () => expect(defaultRangeFrom("2026-01-15")).toBe("2025-12-15"));
  it("그날이 없으면 말일로", () => {
    expect(defaultRangeFrom("2026-03-31")).toBe("2026-02-28");
    expect(defaultRangeFrom("2028-03-30")).toBe("2028-02-29");
  });
});
