import { describe, expect, it } from "vitest";
import type { OpsDaily } from "../ops-daily";
import { filterKeptOps } from "./kept-ops";

const kept: OpsDaily = {
  consult: {
    from: "2026-10-14",
    counts: { received: 5, consulted: 4, levelTest: 3, enrolled: 2, assigned: 1, started: 1 },
    stalled: 1,
  },
  newcomers: {
    total: 1,
    stages: [],
    checksAvailable: true,
    items: [],
  },
};

describe("원생 매일 기록의 이전 운영 지표", () => {
  it("캘린더가 꺼져도 상담 진행을 보존하고 입테 건수만 비운다", () => {
    expect(filterKeptOps(kept, { calendar: false, newcomers: true })).toEqual({
      ...kept,
      consult: { ...kept.consult, counts: { ...kept.consult?.counts, levelTest: null } },
    });
    expect(kept.consult?.counts.levelTest).toBe(3);
  });

  it("신규생 관리가 꺼지면 이전 신규생 지표만 뺀다", () => {
    expect(filterKeptOps(kept, { calendar: true, newcomers: false })).toEqual({ consult: kept.consult });
  });
});
