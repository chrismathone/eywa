import { describe, expect, it } from "vitest";
import type { HistoryMonth } from "./history";
import { historyCount, historyFlowRows, historyTrendPoints, joinFlowRows, joinNote, splitBySource } from "./joined";
import { availableRanges, flowTotals, joinPoints, pointsFor, withDeltas, type Point, type SeriesSet } from "./model";

const h = (month: string, data: Partial<Omit<HistoryMonth, "month" | "estimated">>): HistoryMonth => ({ month, estimated: [], ...data });
const months: HistoryMonth[] = [
  h("2025-01", { payingTotal: 380, newReal: 20, stoppedPaying: 10 }),
  h("2025-02", { payingTotal: 370, newReal: 18, stoppedPaying: 12 }),
  h("2025-03", { payingTotal: 390, enrolledRecord: 420, newReal: 25, stoppedPaying: 9 }),
  h("2025-12", { payingTotal: 397, enrolledRecord: 432, newReal: 24, stoppedPaying: 32 }),
  h("2026-01", { payingTotal: 389, enrolledRecord: 401, newReal: 23, stoppedPaying: 17 }),
  h("2026-03", { payingTotal: 427, enrolledRecord: 428, newReal: 29 }), // 끊긴 학생은 아직 못 센 달
  h("2026-04", { payingTotal: 418, newReal: 10, stoppedPaying: 16 }),
];
const p = (key: string, count: number, date = `${key}-28`): Point => ({ key, label: key, date, count });

describe("지난 기록 잇기(원장 2026-10-21 전체 추이)", () => {
  it("재원생 = 메이크에듀 재원생 기록이 먼저, 없으면 수업료가 청구된 학생 · 둘 다 없으면 점 없음", () => {
    expect(historyCount(h("2025-03", { payingTotal: 390, enrolledRecord: 420 }))).toBe(420);
    expect(historyCount(h("2025-01", { payingTotal: 380 }))).toBe(380);
    expect(historyCount(h("2025-01", { newReal: 3 }))).toBeNull();
  });

  it("월별 점은 경계 달 앞만 · 말일 날짜 · source=history · 연도별은 해마다 마지막 기록 달 값, 에이와가 세는 해는 뺀다", () => {
    const hp = historyTrendPoints(months, "2026-04");
    expect(hp.monthly.map((x) => [x.key, x.count, x.date, x.source])).toEqual([
      ["2025-01", 380, "2025-01-31", "history"],
      ["2025-02", 370, "2025-02-28", "history"],
      ["2025-03", 420, "2025-03-31", "history"],
      ["2025-12", 432, "2025-12-31", "history"],
      ["2026-01", 401, "2026-01-31", "history"],
      ["2026-03", 428, "2026-03-31", "history"],
    ]);
    expect(hp.yearly.map((x) => [x.key, x.count, x.date])).toEqual([["2025", 432, "2025-12-31"]]);
    // 경계가 없으면 전부(겹침은 joinPoints가 정리한다).
    expect(historyTrendPoints(months, null).monthly).toHaveLength(7);
  });

  it("joinPoints — 에이와 첫 점보다 앞선 지난 기록만 앞에 붙이고 겹치는 달은 에이와가 이긴다", () => {
    const hp = historyTrendPoints(months, null).monthly;
    const aywa = [p("2026-04", 410), p("2026-05", 415)];
    expect(joinPoints(hp, aywa).map((x) => `${x.key}:${x.count}${x.source ? "h" : ""}`)).toEqual(["2025-01:380h", "2025-02:370h", "2025-03:420h", "2025-12:432h", "2026-01:401h", "2026-03:428h", "2026-04:410", "2026-05:415"]);
    expect(joinPoints(hp, [])).toHaveLength(7);
  });

  it("pointsFor — 전체 기간·연도별엔 지난 기록을 잇고 주별엔 안 잇는다 · 최근 12개월은 이은 축의 뒤 12칸 · 기간 버튼도 이은 길이로", () => {
    const set: SeriesSet = { monthly: [p("2026-03", 300), p("2026-04", 410), p("2026-05", 415)], weekly: [p("2026-05-03", 414)], yearly: [p("2026", 415, "2026-05-20")] };
    const history = historyTrendPoints(months, "2026-04");
    const all = pointsFor(set, "all", "2026-04", history);
    expect(all.map((x) => x.key)).toEqual(["2025-01", "2025-02", "2025-03", "2025-12", "2026-01", "2026-03", "2026-04", "2026-05"]);
    expect(pointsFor(set, "y", "2026-04", history).map((x) => x.key)).toEqual(["2025", "2026"]);
    expect(pointsFor(set, "w26", "2026-04", history).map((x) => x.key)).toEqual(["2026-05-03"]);
    expect(pointsFor(set, "m12", "2026-04", history)).toHaveLength(8);
    expect(availableRanges(set, "2026-04", history)).toEqual(["all", "w26", "y"]);
    // 종전 호출(history 없음)은 그대로.
    expect(pointsFor(set, "all", "2026-04").map((x) => x.key)).toEqual(["2026-04", "2026-05"]);
  });

  it("splitBySource — 꺾은선은 경계 점을 지난 기록 선도 지나고(bridge) 막대는 안 지난다", () => {
    const pts: Point[] = [{ ...p("2026-03", 428), source: "history" }, p("2026-04", 410), p("2026-05", 415)];
    expect(splitBySource(pts, true)).toEqual({ history: [428, 410, null], aywa: [null, 410, 415] });
    expect(splitBySource(pts, false)).toEqual({ history: [428, null, null], aywa: [null, 410, 415] });
    expect(splitBySource([p("2026-04", 410)], true)).toEqual({ history: [null], aywa: [410] });
  });

  it("등록·퇴원 — 지난 기록 달은 등록(newReal)·청구가 끊긴 학생(모르면 null)으로, 에이와 첫 달 앞만 · 합계는 모르는 달을 뺀다", () => {
    const rows = historyFlowRows(months, "2026-04");
    expect(rows.map((r) => [r.month, r.enrolled, r.withdrawn, r.source, r.startedOnly])).toEqual([
      ["2025-01", 20, 10, "history", true],
      ["2025-02", 18, 12, "history", true],
      ["2025-03", 25, 9, "history", true],
      ["2025-12", 24, 32, "history", true],
      ["2026-01", 23, 17, "history", true],
      ["2026-03", 29, null, "history", true],
    ]);
    const joined = joinFlowRows(rows, [{ month: "2026-04", enrolled: 10, withdrawn: 5 }]);
    expect(joined.at(-1)).toEqual({ month: "2026-04", enrolled: 10, withdrawn: 5 });
    expect(joined).toHaveLength(7);
    // 순증은 퇴원을 아는 달만(2026-03의 등록 29는 순증에 안 든다 — 리뷰 2026-10-21).
    expect(flowTotals(joined)).toEqual({ enrolled: 149, withdrawn: 85, net: 35, unknownMonths: 1 });
  });

  it("withDeltas — 출처가 바뀌는 칸(지난 기록 → 에이와)의 증감은 비운다", () => {
    const pts: Point[] = [{ ...p("2026-02", 420), source: "history", basis: "record" }, { ...p("2026-03", 428), source: "history", basis: "record" }, p("2026-04", 410), p("2026-05", 415)];
    expect(withDeltas(pts).map((x) => x.delta)).toEqual([null, 8, null, 5]);
    // 지난 기록 안에서 재원생 기록 ↔ 청구 학생이 바뀌는 칸도 비운다.
    const inner: Point[] = [{ ...p("2025-02", 370), source: "history", basis: "paying" }, { ...p("2025-03", 420), source: "history", basis: "record" }];
    expect(withDeltas(inner).map((x) => x.delta)).toEqual([null, null]);
    expect(historyTrendPoints(months, "2026-04").monthly.map((x) => x.basis)).toEqual(["paying", "paying", "record", "record", "record", "record"]);
  });

  it("안내 문장은 데이터에서 — 재원생 기록 구간과 청구 구간을 따로 말하고, 메운 점이 없으면 null", () => {
    const hp = historyTrendPoints(months, "2026-04").monthly;
    const note = joinNote(hp, months, "2026-04");
    expect(note).toContain("2026년 4월부터 에이와 기록");
    expect(note).toContain("2025년 3월~2026년 3월은 메이크에듀 재원생 기록");
    expect(note).toContain("2025년 1월~2025년 2월은 수업료가 청구된 학생 수");
    expect(joinNote([], months, "2026-04")).toBeNull();
  });
});
