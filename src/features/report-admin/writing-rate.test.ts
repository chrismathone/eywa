import { describe, it, expect } from "vitest";
import { computeWritingRates } from "./writing-rate";

const DATES = ["2026-07-07", "2026-07-08", "2026-07-09"]; // 화·수·목
const TODAY = "2026-07-09"; // 마지막 날짜를 오늘로

describe("computeWritingRates — 요일별·주간 작성률(%+n/n)", () => {
  it("과거일=주간대상 min(count,target), 오늘=정밀, 주간=합계 작성률", () => {
    const rows = computeWritingRates(
      DATES,
      [
        { teacher: "김선생", date: "2026-07-07" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "김선생", date: "2026-07-09" },
        { teacher: "이선생", date: "2026-07-08" },
      ],
      [{ teacher: "김선생", target: 4, written: 2, missing: ["A", "B"] }, { teacher: "이선생", target: 2, written: 2, missing: [] }],
      [
        { teacher: "김선생", date: "2026-07-07", target: 2 }, // 과거: written=min(1,2)=1 → 50%
        { teacher: "김선생", date: "2026-07-08", target: 3 }, // 과거: written=min(0,3)=0 → 0%
        { teacher: "이선생", date: "2026-07-08", target: 2 }, // 과거: written=min(1,2)=1 → 50%
      ],
      TODAY,
    );
    const kim = rows.find((r) => r.teacher === "김선생")!;
    expect(kim.daily).toEqual([
      { date: "2026-07-07", count: 1, target: 2, written: 1, rate: 50 },
      { date: "2026-07-08", count: 0, target: 3, written: 0, rate: 0 },
      { date: "2026-07-09", count: 2, target: 4, written: 2, rate: 50 }, // 오늘=정밀(todayWritten)
    ]);
    expect(kim.weekTarget).toBe(9); // 2+3+4
    expect(kim.weekWritten).toBe(3); // 1+0+2
    expect(kim.weekRate).toBe(33); // round(3/9*100)
    expect(kim.todayRate).toBe(50);
    expect(kim.todayMissing).toEqual(["A", "B"]);
  });

  it("미래일은 대상 null(수업 전 → '·'), 주간 합계에서 제외", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "박선생", date: "2026-07-07" }],
      [{ teacher: "박선생", target: 2, written: 1, missing: ["y"] }],
      [{ teacher: "박선생", date: "2026-07-07", target: 2 }],
      "2026-07-08", // 오늘=수요일 → 07-09(목)은 미래
    );
    const p = rows.find((r) => r.teacher === "박선생")!;
    expect(p.daily[2]!.target).toBeNull(); // 07-09 미래
    expect(p.daily[2]!.rate).toBeNull();
    // 07-07 past target 2 written min(1,2)=1, 07-08 today target 2 written 1 → weekTarget 4, weekWritten 2
    expect(p.weekTarget).toBe(4);
    expect(p.weekWritten).toBe(2);
    expect(p.weekRate).toBe(50);
  });

  it("과거일 대상(dailyTarget) 없으면 그 날 대상 null('·', 무수업일)", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "무수업", date: "2026-07-07" }], // 작성은 있으나 대상 미제공
      [{ teacher: "무수업", target: 1, written: 1, missing: [] }],
      [], // dailyTargets 없음
      TODAY,
    );
    const t = rows[0]!;
    expect(t.daily[0]!.target).toBeNull(); // 07-07 대상 없음
    expect(t.daily[0]!.rate).toBeNull();
    expect(t.daily[0]!.count).toBe(1); // 건수는 유지(참고)
  });

  it("worst(오늘 작성률 낮은 순) 먼저, 오늘 대상 없는 강사는 뒤로", () => {
    const rows = computeWritingRates(
      DATES,
      [{ teacher: "무대상", date: "2026-07-08" }],
      [{ teacher: "높음", target: 2, written: 2, missing: [] }, { teacher: "낮음", target: 4, written: 1, missing: ["x"] }],
      [],
      TODAY,
    );
    expect(rows.map((r) => r.teacher)).toEqual(["낮음", "높음", "무대상"]);
  });

  it("오늘 대상 0이면 todayRate null", () => {
    const rows = computeWritingRates(DATES, [], [{ teacher: "휴무", target: 0, written: 0, missing: [] }], [], TODAY);
    expect(rows[0]!.todayRate).toBeNull();
  });
});
