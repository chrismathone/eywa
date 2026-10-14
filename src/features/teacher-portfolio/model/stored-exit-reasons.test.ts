import { describe, expect, it } from "vitest";
import { PORTFOLIO_V1_CONFIG } from "../evaluation/config";
import { excuseStoredExits } from "./stored-exit-reasons";
import type { PortfolioPeriod, StudentEvent } from "./types";

const exit = (studentId: string, type: StudentEvent["type"] = "퇴원"): StudentEvent =>
  ({ studentId, day: "2026-07-20", type, points: -1, direction: "유출", className: "중2", role: "담임" });
/** 옛 구성으로 마감한 7월 — 배정·유지 −1(퇴원 · 수강종료 · 신규) = 9점 + 보강관리 10점. */
const closedJuly = (): PortfolioPeriod => {
  const detail = [exit("a"), exit("b", "수강종료"), { ...exit("c"), type: "신규" as const, points: 1, direction: "유입" as const }];
  const tracking = {
    value: 9, basePoints: 10, adjustment: -1, previousPoints: 10, previous: 5, current: 4, change: -1, newCount: 1, exitCount: 1,
    endedCount: 1, transferIn: 0, transferOut: 0, unscored: 0, homeroom: 4, assistant: 0, detail,
  };
  return {
    month: "2026-07", start: "2026-07-01", end: "2026-07-31", subjects: [], classes: [], students: 4, knownCount: 2, knownScore: 19, knownMax: 30, total: 19,
    evaluation: PORTFOLIO_V1_CONFIG,
    items: [
      { id: "students", max: 20, raw: -1, value: 9, basis: "", reason: "", detail, tracking },
      { id: "coverage", max: 10, raw: 100, value: 10, basis: "", reason: "", detail: [], due: 0, done: 0, pending: 0, early: 0 },
    ],
  } as unknown as PortfolioPeriod;
};

describe("마감한 달에 사유 규칙 얹기(원장 2026-10-14 '새 규칙 적용')", () => {
  it("사유로 빼는 퇴원만 −1 → 0 · 그 달 설정으로 그 항목 점수와 합계를 다시 낸다 · 다른 항목은 그대로", () => {
    const p = closedJuly();
    expect(excuseStoredExits(p, (e) => (e.studentId === "a" ? "사유 졸업" : null))).toBe(1);
    const st = p.items[0] as Extract<PortfolioPeriod["items"][number], { id: "students" }>;
    expect([st.raw, st.value, st.tracking.value, st.tracking.exitCount, st.tracking.endedCount, st.tracking.excused, st.tracking.unscored]).toEqual([0, 10, 10, 0, 1, 1, 1]);
    expect(st.detail).toBe(st.tracking.detail);
    expect(st.detail[0]).toMatchObject({ points: 0, note: "사유 졸업" });
    expect([p.total, p.knownScore, p.knownMax, p.knownCount, p.items[1]!.value]).toEqual([20, 20, 30, 2, 10]);
    // 두 번 돌려도 같다(이미 까닭이 붙은 줄은 건너뛴다) · 설정이 없는 옛 행은 고치지 않는다.
    expect(excuseStoredExits(p, () => "사유 졸업")).toBe(1);
    expect(excuseStoredExits(p, () => "사유 졸업")).toBe(0);
    const legacy = closedJuly();
    delete (legacy as Partial<PortfolioPeriod>).evaluation;
    expect(excuseStoredExits(legacy, () => "사유 졸업")).toBe(0);
    expect(legacy.total).toBe(19);
  });
});
