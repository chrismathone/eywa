import { describe, expect, it } from "vitest";
import { applyTodaysMathFill, todaysMathMarked, type TodaysMathFillRow } from "./todays-math-fill-rules";
import { resolveRowFields } from "./row-fields";
import type { OneScreenStudent, Subject } from "./types";

const math = (over: Partial<Subject> = {}): Subject => ({ name: "수학", subjectKey: "math", classId: "c1", ...over }) as Subject;
const student = (subjects: Subject[], over: Partial<OneScreenStudent> = {}): OneScreenStudent =>
  ({
    id: "s1",
    subjects,
    tests: { daily: { score: null, max: 5, prevScore: null }, check: { score: null, max: 5, prevScore: null } },
    ...over,
  }) as OneScreenStudent;
const row = (over: Partial<TodaysMathFillRow> = {}): TodaysMathFillRow => ({
  student_id: "s1", class_id: "c1", kind: "daily", question_count: 20, absent: false, correct_count: 18, taken_at: "2026-10-17T01:00:00Z", ...over,
});
const opts = { daily: true, check: true, isMathRow: (su: Subject) => (su.subjectKey ?? "math") === "math" };

describe("오늘 수학 결과로 원스크린 시험 칸 채우기", () => {
  it("fills an empty daily cell from the same class with count and question total, and marks it", () => {
    const s = student([math()]);
    applyTodaysMathFill(s, [row(), row({ kind: "review", correct_count: 9, question_count: 10 })], opts);
    const t = resolveRowFields(s, s.subjects[0]).tests;
    expect([t.daily.score, t.daily.max, t.check.score, t.check.max]).toEqual([18, 20, 9, 10]);
    expect(todaysMathMarked(s.subjects[0], "daily", t.daily)).toBe(true);
  });

  it("never overwrites a teacher value, and marks only when it already equals the result", () => {
    const typed = student([math({ dailyScore: 15, dailyMax: 20 })]);
    applyTodaysMathFill(typed, [row()], opts);
    expect(typed.subjects[0].dailyScore).toBe(15);
    expect(typed.subjects[0].todaysMath).toBeUndefined();
    const same = student([math({ dailyScore: 18, dailyMax: 20 })]);
    applyTodaysMathFill(same, [row()], opts);
    expect(todaysMathMarked(same.subjects[0], "daily", resolveRowFields(same, same.subjects[0]).tests.daily)).toBe(true);
    // 학생 단위 값(옛 세션)도 선생님 값이다.
    const legacy = student([math()], { tests: { daily: { score: 3, max: 5, prevScore: null }, check: { score: null, max: 5, prevScore: null } } });
    applyTodaysMathFill(legacy, [row()], opts);
    expect(legacy.subjects[0].dailyScore).toBeUndefined();
  });

  it("does not write 0 for absence, unknown counts, or zero questions", () => {
    for (const r of [row({ absent: true, correct_count: null }), row({ correct_count: null }), row({ question_count: 0, correct_count: 0 }), row({ correct_count: 21 })]) {
      const s = student([math()]);
      applyTodaysMathFill(s, [r], opts);
      expect(s.subjects[0].dailyScore).toBeUndefined();
    }
  });

  it("matches by class; a result without class only fills a single math row", () => {
    const two = student([math(), math({ name: "수학 · 특강", classId: "c2" })]);
    applyTodaysMathFill(two, [row({ class_id: "c2" }), row({ class_id: null, kind: "review" })], opts);
    expect([two.subjects[0].dailyScore, two.subjects[1].dailyScore]).toEqual([undefined, 18]);
    expect([two.subjects[0].checkScore, two.subjects[1].checkScore]).toEqual([undefined, undefined]);
    const one = student([math()]);
    applyTodaysMathFill(one, [row({ class_id: null })], opts);
    expect(one.subjects[0].dailyScore).toBe(18);
  });

  it("skips sent, makeup, split and non-math rows, and kinds switched off in settings", () => {
    for (const su of [math({ reportSent: true }), math({ makeup: true }), math({ splitIn: "x" }), math({ subjectKey: "english" })]) {
      const s = student([su]);
      applyTodaysMathFill(s, [row()], opts);
      expect(s.subjects[0].dailyScore).toBeUndefined();
    }
    const off = student([math()]);
    applyTodaysMathFill(off, [row()], { ...opts, daily: false });
    expect(off.subjects[0].dailyScore).toBeUndefined();
  });

  it("uses the latest grading when there are several, and the mark disappears once the teacher edits", () => {
    const s = student([math()]);
    applyTodaysMathFill(s, [row({ correct_count: 10 }), row({ correct_count: 19, taken_at: "2026-10-17T02:00:00Z" })], opts);
    expect(s.subjects[0].dailyScore).toBe(19);
    expect(todaysMathMarked(s.subjects[0], "daily", { score: 17, max: 20 })).toBe(false);
    expect(todaysMathMarked(s.subjects[0], "daily", { score: 19, max: 25 })).toBe(false);
  });
});
