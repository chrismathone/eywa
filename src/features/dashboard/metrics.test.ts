import { describe, it, expect } from "vitest";
import { enrollmentDelta, buildActionItems, trendDelta } from "./metrics";

describe("enrollmentDelta", () => {
  it("양수", () => expect(enrollmentDelta(5, 3)).toBe(2));
  it("음수", () => expect(enrollmentDelta(2, 3)).toBe(-1));
  it("0", () => expect(enrollmentDelta(4, 4)).toBe(0));
});

describe("buildActionItems", () => {
  it("전부 0 → 빈 배열", () => {
    expect(buildActionItems({ unpaidCount: 0, absenceRisk: 0, aiWaiting: 0, newConsults: 0 })).toEqual(
      [],
    );
  });

  it("일부 0은 제외하고 우선순위 순서 유지", () => {
    const items = buildActionItems({ unpaidCount: 6, absenceRisk: 0, aiWaiting: 2, newConsults: 0 });
    expect(items.map((i) => i.key)).toEqual(["unpaid", "ai"]);
  });

  it("unpaidCount undefined → 미수 제외", () => {
    const items = buildActionItems({ absenceRisk: 1, aiWaiting: 0, newConsults: 0 });
    expect(items.map((i) => i.key)).toEqual(["absence"]);
  });

  it("전부 양수 → 4항목 + href/color 정확", () => {
    const items = buildActionItems({ unpaidCount: 6, absenceRisk: 3, aiWaiting: 2, newConsults: 2 });
    expect(items).toHaveLength(4);
    const unpaid = items.find((i) => i.key === "unpaid")!;
    expect(unpaid.href).toBe("/billing");
    expect(unpaid.color).toBe("danger");
  });
});

describe("trendDelta", () => {
  it("상승", () => expect(trendDelta([80, 82, 85])).toBe(5));
  it("하락", () => expect(trendDelta([90, 88, 87])).toBe(-3));
  it("빈배열/단일 → 0", () => {
    expect(trendDelta([])).toBe(0);
    expect(trendDelta([90])).toBe(0);
  });
});
