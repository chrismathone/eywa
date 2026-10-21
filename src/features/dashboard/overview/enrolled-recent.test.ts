import { describe, expect, it } from "vitest";
import { enrolledRecentFrom, splitEnrolledRecent } from "./enrolled-recent";

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
