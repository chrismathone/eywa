import { describe, it, expect } from "vitest";
import { courseDuration, subjectPeriods } from "./course-period";
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

describe("수강기간 = 그 과목의 전체 수강 이력(원장 2026-10-29)", () => {
  const label = (s: string) => ({ english: "영어", math: "수학" })[s] ?? s;
  it("지난 반 포함 — 과목 처음 시작일부터, 반마다 한 줄", () => {
    const text = subjectPeriods([{ subject: "english", className: "중등E_중2 심화", startDate: "2026-03-02" }], [
      { subject: "english", className: "중등E_중1 기본", startDate: "2025-03-03", endDate: "2026-02-28" },
      { subject: "english", className: "중등E_중2 심화", startDate: "2026-03-02", endDate: null },
    ], "2026-10-28", label);
    expect(text).toBe("2025-03-03 ~ 2026-10-28 (19개월, 25일)\n· 중등E_중1 기본 2025-03-03 ~ 2026-02-28\n· 중등E_중2 심화 2026-03-02 ~ 2026-10-28");
  });
  it("같은 과목의 계속 다니는 반은 빼고 · 쉬었다 다시 다니면 중단 N회(리뷰)", () => {
    const text = subjectPeriods([{ id: "a", subject: "math", className: "A반", startDate: "2026-03-01" }], [
      { enrollmentId: "old", subject: "math", className: "옛반", startDate: "2024-03-01", endDate: "2024-06-30" },
      { enrollmentId: "a", subject: "math", className: "A반", startDate: "2026-03-01", endDate: null },
      { enrollmentId: "b", subject: "math", className: "B반(계속)", startDate: "2025-01-01", endDate: null },
    ], "2026-10-01", label);
    expect(text).not.toContain("B반");
    expect(text.split("\n")[0]).toBe("2024-03-01 ~ 2026-10-01 (31개월, 0일 · 중단 1회)");
    expect(text).toContain("· 옛반 2024-03-01 ~ 2024-06-30");
    expect(text).toContain("· A반 2026-03-01 ~ 2026-10-01");
  });
  it("반 하나면 한 줄 · 이력이 없으면 지금 반 시작일 · 과목이 둘이면 과목 이름", () => {
    expect(subjectPeriods([{ subject: "math", className: "M", startDate: "2026-09-01" }], [], "2026-10-01", label)).toBe("2026-09-01 ~ 2026-10-01 (1개월, 0일)");
    expect(subjectPeriods([
      { subject: "math", className: "M", startDate: "2026-09-01" },
      { subject: "english", className: "E", startDate: "2026-08-01" },
    ], [], "2026-10-01", label)).toBe("수학: 2026-09-01 ~ 2026-10-01 (1개월, 0일)\n영어: 2026-08-01 ~ 2026-10-01 (2개월, 0일)");
  });
});
