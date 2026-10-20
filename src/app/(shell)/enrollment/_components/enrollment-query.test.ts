import { describe, expect, it } from "vitest";
import { formatRangeLabel } from "./enrollment-query";

describe("기간 프리셋 라벨 — 월 이동 칸이 목록과 같은 구간을 말한다", () => {
  it("같은 해면 `2026년 8~10월`", () => {
    expect(formatRangeLabel("2026-08", "2026-10")).toBe("2026년 8~10월");
  });
  it("해를 넘으면 양쪽 해를 적는다", () => {
    expect(formatRangeLabel("2025-11", "2026-10")).toBe("2025년 11월~2026년 10월");
  });
  it("한 달이면 그 달", () => {
    expect(formatRangeLabel("2026-10", "2026-10")).toBe("2026년 10월");
  });
});
