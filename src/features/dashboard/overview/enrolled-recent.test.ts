import { describe, expect, it } from "vitest";
import { assignedEntryAt, enrolledRecentFrom, splitEnrolledRecent } from "./enrolled-recent";

describe("전일 / 이달 신규 — 창과 가르기", () => {
  it("평일은 이번 달 1일부터 · 1일엔 어제(지난달 말)부터", () => {
    expect(enrolledRecentFrom("2026-10-21")).toBe("2026-10-01");
    expect(enrolledRecentFrom("2026-10-01")).toBe("2026-09-30");
  });

  it("어제는 어제만, 이번 달은 오늘 포함 · 1일의 어제는 이번 달에 안 들어간다", () => {
    const rows = [{ date: "2026-10-20" }, { date: "2026-10-21" }, { date: "2026-10-03" }, { date: "2026-09-30" }];
    const mid = splitEnrolledRecent(rows, "2026-10-21");
    expect(mid.yesterday).toHaveLength(1);
    expect(mid.month).toHaveLength(3);
    const first = splitEnrolledRecent([{ date: "2026-09-30" }, { date: "2026-10-01" }], "2026-10-01");
    expect(first.yesterday.map((r) => r.date)).toEqual(["2026-09-30"]);
    expect(first.month.map((r) => r.date)).toEqual(["2026-10-01"]);
  });

  it("날짜 없는 옛 줄은 오늘로", () => {
    const out = splitEnrolledRecent([{ date: null }], "2026-10-21");
    expect(out.yesterday).toHaveLength(0);
    expect(out.month).toHaveLength(1);
  });
});

describe("반 배정으로 '등록 완료'에 선 때(칸반과 같은 판정)", () => {
  const consult = "2026-10-15T05:31:58Z";
  it("상담 뒤 처음 배정된 때 · 지금 배정이 없으면 없음", () => {
    expect(assignedEntryAt({ consultCreatedAt: consult, subject: "english", today: "2026-10-22",
      enrollments: [{ subject: "english", createdAt: "2026-10-16T11:18:05Z", endDate: null }] })).toBe("2026-10-16T11:18:05Z");
    expect(assignedEntryAt({ consultCreatedAt: consult, subject: "english", today: "2026-10-22",
      enrollments: [{ subject: "english", createdAt: "2026-10-16T11:18:05Z", endDate: "2026-10-20" }] })).toBeNull();
  });
  it("다른 과목 반은 세지 않는다 · 상담 과목이 없으면 전 과목", () => {
    const enrollments = [{ subject: "math", createdAt: "2026-10-16T00:00:00Z", endDate: null }];
    expect(assignedEntryAt({ consultCreatedAt: consult, subject: "english", today: "2026-10-22", enrollments })).toBeNull();
    expect(assignedEntryAt({ consultCreatedAt: consult, subject: null, today: "2026-10-22", enrollments })).toBe("2026-10-16T00:00:00Z");
  });
  it("반 이동으로 새 수강이 생겨도 처음 배정된 때 · 이미 다니던 학생은 상담 접수 때", () => {
    expect(assignedEntryAt({ consultCreatedAt: "2026-03-01T00:00:00Z", subject: "math", today: "2026-10-22", enrollments: [
      { subject: "math", createdAt: "2026-03-05T00:00:00Z", endDate: "2026-10-10" },
      { subject: "math", createdAt: "2026-10-10T00:00:00Z", endDate: null },
    ] })).toBe("2026-03-05T00:00:00Z");
    expect(assignedEntryAt({ consultCreatedAt: consult, subject: "math", today: "2026-10-22",
      enrollments: [{ subject: "math", createdAt: "2025-03-01T00:00:00Z", endDate: null }] })).toBe(consult);
  });
});
