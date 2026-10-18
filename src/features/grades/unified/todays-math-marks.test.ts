import { describe, expect, it } from "vitest";
import { todaysMathMarkedKeys, type TodaysMathMarkRow } from "./todays-math-marks";

const res = (over: Partial<TodaysMathMarkRow>): TodaysMathMarkRow => ({
  student_id: "s", kind: "daily", test_date: "2026-10-16", absent: false, score: 80, max_score: 100, correct_count: 4, question_count: 5, ...over,
});
const row = (key: string, over: Record<string, unknown>) => ({
  key, studentId: "s", subject: "math", kind: "daily", source: "report", date: "2026-10-16", score: 4, maxScore: 5, ...over,
}) as Parameters<typeof todaysMathMarkedKeys>[0][number];

describe("성적 현황 '오늘 수학' 표시 — 같은 값만", () => {
  it("daily/check: same day, same kind, same correct count and question count", () => {
    const results = [res({}), res({ kind: "review", correct_count: 3 })];
    expect(todaysMathMarkedKeys([
      row("d", {}), row("c", { kind: "check", score: 3 }), row("x", { score: 5 }), row("y", { date: "2026-10-17" }),
      row("z", { maxScore: 7 }), row("o", { studentId: "other" }),
    ], results)).toEqual(["d", "c"]);
  });
  it("monthly: same month, same score and full mark; absent never; non-math and other sources never", () => {
    const results = [res({ kind: "monthly", test_date: "2026-10-28", score: 84, max_score: 100 }), res({ kind: "daily", absent: true, correct_count: null })];
    expect(todaysMathMarkedKeys([
      row("m", { kind: "monthly", source: "grade", date: "2026-10-30", score: 84, maxScore: 100 }),
      row("m2", { kind: "monthly", source: "grade", date: "2026-09-30", score: 84, maxScore: 100 }),
      row("m3", { kind: "monthly", source: "grade", date: "2026-10-30", score: 84, maxScore: 50 }),
      row("e", { subject: "english" }), row("l", { source: "level" }), row("a", { score: 0 }),
    ], results)).toEqual(["m"]);
  });
});
