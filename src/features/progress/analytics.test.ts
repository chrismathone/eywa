import { describe, it, expect } from "vitest";
import { computeSpeedStats, percentileOf, predict } from "./analytics";
import { TOTAL_LESSONS } from "./curriculum-position";

describe("computeSpeedStats", () => {
  const today = "2026-07-09";
  it("forward-only 인접 delta 합 / 수업일·span", () => {
    const s = computeSpeedStats(
      [
        { globalPosition: 1, entryDate: "2026-07-01" },
        { globalPosition: 3, entryDate: "2026-07-03" },
        { globalPosition: 2, entryDate: "2026-07-05" }, // 역행 기여 0
        { globalPosition: 6, entryDate: "2026-07-08" },
      ],
      30,
      today,
    );
    expect(s.advancement).toBe(6); // (3-1)+0+(6-2)
    expect(s.lessonDays).toBe(4);
    expect(s.speedPerLessonDay).toBeCloseTo(1.5); // 6/4
    expect(s.speedPerDay).toBeCloseTo(6 / 7); // span 07-01~07-08 = 7일
  });
  it("창(sinceDays) 밖 엔트리 제외", () => {
    const s = computeSpeedStats(
      [
        { globalPosition: 1, entryDate: "2026-05-01" }, // 30일 밖
        { globalPosition: 10, entryDate: "2026-07-08" },
      ],
      30,
      today,
    );
    expect(s.windowEntries).toBe(1);
    expect(s.speedPerLessonDay).toBe(0); // <2건
  });
  it("엔트리 0~1건 → 0", () => {
    expect(computeSpeedStats([], 30, today).speedPerLessonDay).toBe(0);
    expect(computeSpeedStats([{ globalPosition: 5, entryDate: "2026-07-08" }], 30, today).speedPerDay).toBe(0);
  });
});

describe("percentileOf", () => {
  it("중간순위법 (below + equal/2)/count", () => {
    expect(percentileOf(3, [1, 2, 3, 4])).toBe(63); // (2+0.5)/4=0.625→63
    expect(percentileOf(5, [1, 2, 3, 4])).toBe(100);
    expect(percentileOf(0, [1, 2, 3, 4])).toBe(0);
  });
  it("표본 0 → null, 1 → 50", () => {
    expect(percentileOf(3, [])).toBeNull();
    expect(percentileOf(3, [9])).toBe(50);
  });
});

describe("predict", () => {
  it("pos + speed*d, 범위 clamp", () => {
    expect(predict(100, 1, [30, 90])).toEqual([
      { days: 30, position: 130 },
      { days: 90, position: 190 },
    ]);
    expect(predict(TOTAL_LESSONS - 2, 5, [30])[0]!.position).toBe(TOTAL_LESSONS); // 상한 clamp
  });
  it("speed 0 → 제자리", () => {
    expect(predict(50, 0, [30, 90]).map((p) => p.position)).toEqual([50, 50]);
  });
});
