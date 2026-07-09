import { describe, it, expect } from "vitest";
import { computeWritingRates } from "./writing-rate";

const DATES = ["2026-07-07", "2026-07-08", "2026-07-09"];

describe("computeWritingRates", () => {
  it("강사×일별 건수 버킷 + 주간합 + 오늘 작성률", () => {
    const rows = computeWritingRates(
      DATES,
      [
        { teacher: "김선생", date: "2026-07-07" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "이선생", date: "2026-07-08" },
      ],
      [
        { teacher: "김선생", target: 4, written: 2, missing: ["A", "B"] },
        { teacher: "이선생", target: 2, written: 2, missing: [] },
      ],
    );
    const kim = rows.find((r) => r.teacher === "김선생")!;
    expect(kim.daily).toEqual([
      { date: "2026-07-07", count: 1 },
      { date: "2026-07-08", count: 0 },
      { date: "2026-07-09", count: 2 },
    ]);
    expect(kim.weekTotal).toBe(3);
    expect(kim.todayRate).toBe(50); // 2/4
    expect(kim.todayMissing).toEqual(["A", "B"]);
    const lee = rows.find((r) => r.teacher === "이선생")!;
    expect(lee.todayRate).toBe(100);
  });

  it("worst(작성률 낮은 순) 먼저, 오늘 대상 없는 강사는 뒤로", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "무대상", date: "2026-07-08" }],
      [
        { teacher: "높음", target: 2, written: 2, missing: [] }, // 100%
        { teacher: "낮음", target: 4, written: 1, missing: ["x"] }, // 25%
        // 무대상: 오늘 대상 없음(todayRate null) → 뒤로
      ],
    );
    expect(rows.map((r) => r.teacher)).toEqual(["낮음", "높음", "무대상"]);
  });

  it("오늘 대상 0이면 작성률 null", () => {
    const rows = computeWritingRates(DATES, [], [{ teacher: "휴무", target: 0, written: 0, missing: [] }]);
    expect(rows[0]!.todayRate).toBeNull();
  });
});
