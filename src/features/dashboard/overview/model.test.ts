import { describe, expect, it } from "vitest";
import {
  distribution,
  datedWithdrawals,
  mergeSnapshot,
  monthlyChanges,
  monthKeys,
  processingSummary,
  type OverviewSnapshot,
} from "./model";
import { overviewTables, refreshDelay } from "./realtime";

const snapshot = (
  overrides: Partial<OverviewSnapshot> = {},
): OverviewSnapshot => ({
  scope: "tenant:user:master:all",
  tenantId: "tenant",
  academy: "학원",
  today: "2026-09-10",
  requestedAt: 100,
  allowed: ["dashboard", "students"],
  subjects: {},
  sections: {},
  ...overrides,
});
const students = {
  enrolled: 8,
  subjects: [],
  grades: [],
  levels: [],
  schools: [],
};

it("excludes undated system cleanup from withdrawal trends, retaining known history", () => {
  const dates = datedWithdrawals([
    { withdrawn_at: "2026-07-10", enrollments: [] },
    { withdrawn_at: "2026-07-03", enrollments: [] },
    { withdrawn_at: "2026-07-10", enrollments: [{ id: "known" }] },
    { withdrawn_at: "2026-07-20", enrollments: [] },
  ]);
  expect(dates).toEqual(["2026-07-10", "2026-07-20"]);
  expect(
    monthlyChanges("2026-09-10", [], dates).find((r) => r.month === "2026-07")
      ?.withdrawn,
  ).toBe(2);
});

describe("overview freshness and permissions", () => {
  it("retains last successful data and its original time on a partial failure", () => {
    const old = snapshot({
      sections: { students: { data: students, at: 90, error: false } },
    });
    const next = snapshot({
      requestedAt: 200,
      sections: { students: { data: null, at: null, error: true } },
    });
    expect(mergeSnapshot(old, next).sections.students).toEqual({
      data: students,
      at: 90,
      error: true,
    });
  });
  it("does not turn first-load failures or successful empty data into fabricated metrics", () => {
    const failed = snapshot({
      sections: { attendance: { data: null, at: null, error: true } },
    });
    expect(mergeSnapshot(undefined, failed)).toEqual(failed);
    const empty = snapshot({
      sections: { attendance: { data: null, at: 90, error: false } },
    });
    expect(mergeSnapshot(empty, failed).sections.attendance).toEqual({
      data: null,
      at: 90,
      error: true,
    });
  });
  it("revoked areas disappear even if the old response had data", () => {
    const old = snapshot({
      sections: { students: { data: students, at: 90, error: false } },
    });
    expect(
      mergeSnapshot(old, snapshot({ requestedAt: 200, allowed: ["dashboard"] }))
        .sections.students,
    ).toBeUndefined();
  });
  it("does not carry data across users, teacher views, tenants or a new calendar day", () => {
    const old = snapshot({
      sections: { students: { data: students, at: 90, error: false } },
    });
    for (const overrides of [
      { scope: "other:user" },
      { scope: "tenant:user:master:teacher" },
      { today: "2026-09-11" },
    ]) {
      const next = snapshot({
        requestedAt: 200,
        ...overrides,
        sections: { students: { data: null, at: null, error: true } },
      });
      expect(mergeSnapshot(old, next).sections.students?.data).toBeNull();
    }
  });
  it("ignores out-of-order responses", () => {
    const latest = snapshot({ requestedAt: 200 });
    expect(mergeSnapshot(latest, snapshot())).toBe(latest);
  });
  it("subscribes only to authorized sources and bounds event bursts", () => {
    expect(overviewTables(["dashboard", "newcomers"])).toEqual([
      "student_onboarding_checks",
      "announcements",
    ]);
    expect(overviewTables(["students"])).not.toContain("invoices");
    expect(refreshDelay(1000, 1000)).toBe(1200);
    expect(refreshDelay(1000, 5500)).toBe(500);
    expect(refreshDelay(1000, 9000)).toBe(0);
  });
});

describe("overview metric boundaries", () => {
  it("keeps six months across a year boundary and excludes future changes", () => {
    expect(monthKeys("2026-02-02")).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    const rows = monthlyChanges(
      "2026-02-02",
      ["2026-02-01", "2026-02-03", "2025-08-30"],
      ["2025-12-31", "2026-02-02"],
    );
    expect(rows.at(-1)).toEqual({
      month: "2026-02",
      enrolled: 1,
      withdrawn: 1,
    });
    expect(rows.reduce((sum, row) => sum + row.enrolled, 0)).toBe(1);
  });
  it("preserves unclassified students so chart totals match the KPI", () => {
    const rows = distribution(["초1", null, " ", "초1", "중3"]);
    expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(5);
    expect(rows.find((r) => r.label === "미입력")?.value).toBe(2);
  });
  it("partial attendance is never counted as a completed class", () => {
    const make = (expected: number, recorded: number, unprocessed: number) => ({
      classId: `${expected}:${recorded}`,
      className: "반",
      subject: "math",
      teacherName: null,
      expected,
      recorded,
      unprocessed,
      rate: 0,
    });
    expect(
      processingSummary([
        make(10, 4, 6),
        make(5, 0, 5),
        make(8, 8, 0),
        make(0, 1, 0),
      ]),
    ).toEqual({
      expected: 23,
      recorded: 12,
      complete: 1,
      partial: 1,
      unmarked: 1,
      empty: 1,
    });
  });
});
