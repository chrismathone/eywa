import { describe, expect, it } from "vitest";
import { dayWeekLabel, gradeRowsOf, previousPeriod, reportGroups, reportMark, scoredKindOf, totalBefore, weekdayOf } from "./evidence-view";
import type { GradeRow } from "./model/source-types";
import type { ReportCell } from "./model/types";

/** 내역 표의 표시 규칙(원장 2026-10-16). */
describe("내역 표시", () => {
  it("날짜에 요일", () => {
    expect([weekdayOf("2026-09-01"), weekdayOf("2026-09-06"), dayWeekLabel("2026-10-16")]).toEqual(["화", "일", "10.16 (금)"]);
  });
  it("지난달 = 바로 앞 달만 · 총점 비교는 둘 다 합계가 서고 만점이 같을 때만", () => {
    const ps = [{ month: "2026-10" }, { month: "2026-08" }];
    expect(previousPeriod(ps, "2026-10")).toBeUndefined(); // 9월이 비었다 — 8월을 지난달로 보지 않는다
    expect(previousPeriod([{ month: "2026-01" }, { month: "2025-12" }], "2026-01")?.month).toBe("2025-12");
    const w = (total: number | null, knownMax = 100, pending: string[] = []) =>
      ({ total, knownMax, evaluation: {} as never, items: pending.map((id) => ({ id, uncounted: true })) as never });
    expect(totalBefore(w(59.6), w(56.4))).toBe(56.4);
    expect([totalBefore(w(59.6), undefined), totalBefore(w(null), w(50)), totalBefore(w(59.6), w(null)), totalBefore(w(59.6), w(50, 90))])
      .toEqual([null, null, null, null]);
    // 지난달에 계산 전이던 항목이 이번 달 계산되면 견주지 않는다 · 두 달 다 계산 전이면 견준다.
    expect([totalBefore(w(60), w(50, 100, ["punctuality"])), totalBefore(w(60, 100, ["punctuality"]), w(50, 100, ["punctuality"]))]).toEqual([null, 50]);
  });
  it("보고서 표 = 반별 · 열은 그 반 대상 날만 · 작성 O / 미작성 빗금", () => {
    const c = (studentId: string, day: string, className: string, state: ReportCell["state"]): ReportCell => ({ studentId, day, className, state });
    const names: Record<string, string> = { a: "나", b: "가" };
    const gs = reportGroups([c("a", "2026-09-02", "B반", "own"), c("b", "2026-09-01", "A반", "missing"), c("a", "2026-09-01", "A반", "own"), c("b", "2026-09-03", "A반", "proxy")],
      (id) => names[id]);
    expect(gs.map((g) => [g.className, g.days, g.students, g.missing])).toEqual([
      ["A반", ["2026-09-01", "2026-09-03"], ["b", "a"], 2], ["B반", ["2026-09-02"], ["a"], 0],
    ]);
    expect([reportMark("own").mark, reportMark("proxy").mark, reportMark("late").label]).toEqual(["O", "/", "미작성"]);
    // 같은 날 두 반 대상인 칸("A반, B반")은 첫 반 표에 한 번만 — 가짜 반 표가 생기지 않는다.
    const two = reportGroups([c("a", "2026-09-01", "A반", "own"), c("a", "2026-09-02", "A반, B반", "missing"), c("b", "2026-09-02", "B반", "own")], (id) => names[id]);
    expect(two.map((g) => [g.className, g.days, g.missing])).toEqual([["A반", ["2026-09-01", "2026-09-02"], 1], ["B반", ["2026-09-02"], 0]]);
  });
  it("성적 종류 탭 — 저장된 종류별 값 · 옛 줄은 종류 글자로 시험 수(평균은 그 종류만 본 학생만)", () => {
    const r = (over: Partial<GradeRow>): GradeRow => ({ studentId: "s", className: "반", tests: 0, average: null, kinds: "", ...over });
    expect(scoredKindOf(r({ tests: 2, average: 80, kinds: "확인테스트 1 · 내신 1", byKind: { check: { count: 1, average: 100 } } }), "check")).toEqual({ count: 1, average: 100 });
    expect(scoredKindOf(r({ tests: 2, kinds: "확인테스트 1 · 내신 1", byKind: { check: { count: 1, average: 100 } } }), "school")).toBeNull();
    expect(scoredKindOf(r({ tests: 3, average: 70, kinds: "확인테스트 2 · 내신 1" }), "check")).toEqual({ count: 2, average: null });
    expect(scoredKindOf(r({ tests: 2, average: 70, kinds: "확인테스트 2" }), "check")).toEqual({ count: 2, average: 70 });
    const rows = [r({ studentId: "d", daily: { done: 1, total: 2 } }), r({ studentId: "m", monthly: false }), r({ studentId: "x", tests: 1, average: 50, kinds: "기타 시험 1" })];
    expect([gradeRowsOf(rows, "daily", "submit"), gradeRowsOf(rows, "monthly", "take"), gradeRowsOf(rows, "other"), gradeRowsOf(rows, "check")].map((xs) => xs.map((x) => x.studentId)))
      .toEqual([["d"], ["m"], ["x"], []]);
    // 10-15 전에 저장된 달 — 일일테스트도 점수율(셈 없음)이라 종류 글자로 고른다(빈 표가 되지 않게).
    expect(gradeRowsOf([r({ studentId: "o", tests: 2, average: 80, kinds: "일일테스트 2" })], "daily").map((x) => x.studentId)).toEqual(["o"]);
  });
});
