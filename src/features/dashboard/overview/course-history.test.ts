import { describe, expect, it } from "vitest";
import { withCourseHistory } from "./course-history";
import type { CourseTrend } from "./enrolled-trend-server";
import type { HistoryMonth } from "@/features/students/stats/history";

const pt = (key: string, count: number) => ({ key, label: key, date: `${key}-28`, count });
const trend: CourseTrend = { monthly: [pt("2026-07", 400), pt("2026-08", 410), pt("2026-09", 415), pt("2026-10", 419)], yearly: [], trustFrom: "2026-07", monthlyFrom: "2026-07", cutBy: "trust" };
const month = (m: string, o: Partial<HistoryMonth>): HistoryMonth => ({ month: m, estimated: [], ...o });

describe("운영실 강좌수 추이 앞쪽 달 = 지난 기록(원장 2026-10-30 '이전 기록의 과학·국어 반영')", () => {
  it("에이와 기록 전 달을 과목마다 청구된 학생 수의 합으로 메운다 — 과학·국어 포함 · 영어는 인재원 · EiE 따로", () => {
    const months = [
      month("2025-10", { payingMath: 180, payingInjaewon: 150, payingEie: 60, subjects: { science: 20, korean: 40 } }),
      month("2026-06", { payingMath: 190, payingInjaewon: 160, payingEie: 70, subjects: { science: 10, korean: 30 } }),
      month("2026-07", { payingMath: 999 }), // 에이와 달 — 덮지 않는다
    ];
    const v = withCourseHistory(trend, months, ["math", "injaewon", "eie", "science", "korean"], "2026-10-30");
    // 창(최근 12개월 = 2025-11~) 밖의 2025-10은 넣지 않고, 창 안이어도 지난 기록이 없는 달은 비운다.
    expect(v.monthly.map((p) => [p.key, p.count])).toEqual([["2026-06", 460], ["2026-07", 400], ["2026-08", 410], ["2026-09", 415], ["2026-10", 419]]);
    expect([v.historyFrom, v.historyTo]).toEqual(["2026-06", "2026-06"]);
    // 중간이 빈 달에서 멈춘다 — 2026-04는 2026-05가 비어 잇지 않는다.
    const gap = withCourseHistory(trend, [...months, month("2026-04", { payingMath: 1, payingInjaewon: 1, payingEie: 1, subjects: { science: 1, korean: 1 } })], ["math", "injaewon", "eie", "science", "korean"], "2026-10-30");
    expect(gap.historyFrom).toBe("2026-06");
  });
  it("과목을 셀 수 없는 달(묶음 칸이 빈 달)은 비운다 · 메울 달이 없으면 그대로", () => {
    const months = [month("2026-05", { payingMath: 190 })]; // 영어 칸이 없다
    expect(withCourseHistory(trend, months, ["math", "english"], "2026-10-30")).toBe(trend);
    expect(withCourseHistory({ ...trend, monthlyFrom: null }, months, ["math"], "2026-10-30").monthly).toHaveLength(4);
  });
});
