import { describe, expect, it } from "vitest";
import { usedRangeLabel } from "./used-range";

describe("휴가 사용 기간 표기", () => {
  it("하루면 날짜 하나 — 끝이 비었거나 시작과 같을 때", () => {
    expect(usedRangeLabel("2026-08-15", null)).toBe("2026-08-15");
    expect(usedRangeLabel("2026-08-15", undefined)).toBe("2026-08-15");
    expect(usedRangeLabel("2026-08-15", "2026-08-15")).toBe("2026-08-15");
  });

  it("같은 달이면 날짜만, 같은 해면 월·일, 해가 다르면 통째로", () => {
    expect(usedRangeLabel("2026-08-15", "2026-08-17")).toBe("2026-08-15~17");
    expect(usedRangeLabel("2026-08-28", "2026-09-02")).toBe("2026-08-28~09-02");
    expect(usedRangeLabel("2026-12-30", "2027-01-02")).toBe("2026-12-30~2027-01-02");
  });
});
