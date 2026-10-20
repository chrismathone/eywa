import { describe, expect, it } from "vitest";
import { firstRecorded, opsSeries } from "./ops-series";
import { parseStatsPeriod } from "@/features/stats/period";
import type { OpsDaily } from "./ops-daily";

const TODAY = "2026-10-21";
const day = (date: string, received: number | null): { date: string; ops: OpsDaily | null } => ({
  date,
  ops: received === null ? null : { consult: { from: "x", counts: { received, consulted: 0, levelTest: null, enrolled: 0, assigned: 0, started: 0 }, stalled: 0 } },
});

describe("opsSeries — 매일 기록 칸", () => {
  const rows = [day("2026-10-21", 12), day("2026-10-20", 10), day("2026-09-30", 7), day("2026-09-15", 5), day("2026-10-19", null)];
  it("일별 = 그날 · 기록 없는 날은 null", () => {
    const v = opsSeries(rows, parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY), (o) => o.consult?.counts.received);
    expect([v[18], v[19], v[20], v[0]]).toEqual([null, 10, 12, null]);
  });
  it("월별 = 그 달 마지막으로 기록된 날 · 처음 기록일", () => {
    const v = opsSeries(rows, parseStatsPeriod({}, TODAY), (o) => o.consult?.counts.received);
    expect([v.at(-2), v.at(-1), v[0]]).toEqual([7, 12, null]);
    expect(firstRecorded(rows, (o) => !!o.consult)).toBe("2026-09-15");
  });
  it("월별 칸은 날짜를 섞지 않는다 — 마지막 날이 '모름'(null)이면 앞날 값으로 메우지 않는다 · 칸이 없는 날만 건너뛴다", () => {
    const lt = (date: string, levelTest: number | null, consult = true): { date: string; ops: OpsDaily } => ({
      date,
      ops: consult ? { consult: { from: "x", counts: { received: 1, consulted: 0, levelTest, enrolled: 0, assigned: 0, started: 0 }, stalled: 0 } } : {},
    });
    const period = parseStatsPeriod({}, TODAY);
    expect(opsSeries([lt("2026-10-20", 5), lt("2026-10-21", null)], period, (o) => o.consult?.counts.levelTest).at(-1)).toBeNull();
    expect(opsSeries([lt("2026-10-20", 5), lt("2026-10-21", null, false)], period, (o) => o.consult?.counts.levelTest).at(-1)).toBe(5);
  });
});
