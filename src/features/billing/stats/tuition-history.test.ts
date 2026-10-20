import { describe, expect, it } from "vitest";
import { mergeTuitionHistory, yearlyTuition } from "./tuition-history";

describe("지난 기록 — 수업료 수납(원장 2026-10-21)", () => {
  it("두 출처를 달마다 잇고 겹치는 달은 에이와 · 돈 칸이 없는 줄은 뺀다 · 모양이 틀린 값은 버린다", () => {
    const months = mergeTuitionHistory([
      { month: "2026-01", source: "makeedu", data: { enrolledRecord: 401 } },
      { month: "2025-12", source: "makeedu", data: { tuitionPaidGeneral: 130_380_000, tuitionPaidEie: 27_130_000 } },
      { month: "2026-01", source: "aywa", data: { tuitionPaidGeneral: 140_000_000, tuitionPaidEie: 28_000_000 } },
      { month: "2024-05", source: "makeedu", data: { tuitionPaidGeneral: 101_000_000.4, tuitionPaidEie: "x" } },
    ]);
    expect(months).toEqual([
      { month: "2024-05", source: "makeedu", general: 101_000_000 },
      { month: "2025-12", source: "makeedu", general: 130_380_000, eie: 27_130_000 },
      { month: "2026-01", source: "aywa", general: 140_000_000, eie: 28_000_000 },
    ]);
  });

  it("연도별 = 값이 있는 달의 합 · 칸마다 더한 달 수(EiE는 2025-05부터라 그해 8개월)", () => {
    const months = [
      ...["01", "02", "03", "04"].map((m) => ({ month: `2025-${m}`, source: "makeedu" as const, general: 10 })),
      ...["05", "06", "07", "08", "09", "10", "11", "12"].map((m) => ({ month: `2025-${m}`, source: "makeedu" as const, general: 10, eie: 2 })),
    ];
    expect(yearlyTuition(months)).toEqual([{ year: "2025", months: 12, general: 120, eie: 16, generalMonths: 12, eieMonths: 8 }]);
  });
});
