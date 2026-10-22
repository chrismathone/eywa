import { describe, expect, it } from "vitest";
import { buildManagementSheet, completionRate } from "./management-sheet";

const groupsOf = (s: string | null | undefined) => {
  const t = (s ?? "").toLowerCase();
  const out: string[] = [];
  if (/math|수학/.test(t)) out.push("math");
  if (/english|영어|eie/.test(t)) out.push("english");
  return out;
};

describe("관리현황 — 달마다 상담·등록·완료율, 과목 묶음마다", () => {
  const sheet = buildManagementSheet(
    [
      { month: "2026-09", subject: "math", outcome: "enrolled" },
      { month: "2026-09", subject: "수학, 영어", outcome: "declined" },
      { month: "2026-10", subject: "english", outcome: "consulted" },
      { month: "2026-10", subject: "EIE", outcome: "enrolled" },
      { month: "2026-10", subject: null, outcome: "no_show" },
    ],
    groupsOf,
  );

  it("최신 달이 위 · 상태는 칸반 묶음(노쇼 = 미등록)", () => {
    expect(sheet.months.map((m) => m.month)).toEqual(["2026-10", "2026-09"]);
    expect(sheet.months[0]!.all).toEqual({ total: 3, enrolled: 1, declined: 1, open: 1 });
    expect(sheet.months[0]!.unknown).toBe(1);
  });

  it("두 과목 문의는 양쪽에 · 묶음은 상담이 많은 순", () => {
    expect(sheet.groups).toEqual(["english", "math"]);
    expect(sheet.total.groups.math).toEqual({ total: 2, enrolled: 1, declined: 1, open: 0 });
    expect(sheet.total.groups.english).toEqual({ total: 3, enrolled: 1, declined: 1, open: 1 });
    expect(sheet.total.all.total).toBe(5);
  });

  it("완료율 = 등록 ÷ 상담 · 상담 0이면 null", () => {
    expect(completionRate(sheet.total.all)).toBe(40);
    expect(completionRate({ total: 0, enrolled: 0, declined: 0, open: 0 })).toBeNull();
  });
});
