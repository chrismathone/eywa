import { describe, expect, it } from "vitest";
import {
  distribution,
  mergeSnapshot,
  monthlyChanges,
  monthKeys,
  processingSummary,
  type OverviewSnapshot,
} from "./model";
import { overviewTables, refreshDelay } from "./realtime";
import { inWithdrawalWindow, withdrawalMonthWindow } from "@/features/withdrawals/window";

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
  levels: [],
  schools: [],
  concurrent: 0,
  programs: { eie: 0, injaewon: 0, math: 0, both: 0, noEnrollment: 8, otherOnly: 0 },
  gradeSplit: { rows: [], neither: 8 },
};

it("A1 — 이번 달 퇴원 = 1일~오늘: 카드(창 판정)와 추이 패널(월 칸)이 같은 행에서 같은 수, 오늘 이후 퇴원은 둘 다 제외", () => {
  const today = "2026-09-11";
  // getWithdrawalsInWindow가 돌려주는 행 모양(시스템 정리는 이미 빠져 있다) — 오늘 이후 날짜가 섞여 들어와도 막는지 본다.
  // ⚠️ 사유 없는 단체 장부 정리는 추이에서만 빠진다(원장 2026-10-20 · `loadMonthlyChanges`의 `exits`) — 그 달에 장부 정리를 했으면
  //    카드와 추이의 이번 달 퇴원 수가 다를 수 있다. 이 줄들엔 장부 정리가 없다.
  const rows = ["2026-08-31", "2026-09-01", "2026-09-11", "2026-09-25"].map((withdrawnAt) => ({ withdrawnAt }));
  const win = withdrawalMonthWindow(today.slice(0, 7), today);
  const card = rows.filter((row) =>
    inWithdrawalWindow({ withdrawnAt: row.withdrawnAt, systemBulk: false }, win.from, win.to),
  ).length;
  const panel = monthlyChanges(today, [], rows.map((row) => row.withdrawnAt)).at(-1)!;
  expect(panel.month).toBe("2026-09");
  expect(card).toBe(2);
  expect(panel.withdrawn).toBe(card);
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
