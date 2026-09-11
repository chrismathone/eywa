import { describe, expect, it } from "vitest";
import { mergeStatusOf, mergedUnits, planMakeupMerge, type PlanSubject } from "./makeup-merge-plan";

const MINE = new Set(["math"]);
const row = (over: Partial<PlanSubject> = {}): PlanSubject => ({
  name: "수학",
  subjectKey: "math",
  classId: "c1",
  makeup: false,
  attendanceRaw: null,
  attendanceUnits: null,
  ...over,
});

describe("planMakeupMerge", () => {
  it("합칠 정규 행이 있으면 묻는다(자동 합치기 금지)", () => {
    const plan = planMakeupMerge([row()], MINE);
    expect(plan.kind).toBe("ask");
    if (plan.kind === "ask") {
      expect(plan.candidates).toHaveLength(1);
      expect(plan.candidates[0]!.classId).toBe("c1");
    }
  });

  it("후보가 둘이어도 묻는다 — 강사가 고른다(예전엔 물러섰다)", () => {
    const plan = planMakeupMerge([row(), row({ name: "수학 특강", classId: "c2" })], MINE);
    expect(plan.kind).toBe("ask");
    if (plan.kind === "ask") expect(plan.candidates.map((c) => c.name)).toEqual(["수학", "수학 특강"]);
  });

  it("정규 행이 없으면 묻지 않고 분리", () => {
    expect(planMakeupMerge([], MINE).kind).toBe("separate");
  });

  it("반 없는 행(순수 보강)은 합칠 대상이 아니다", () => {
    expect(planMakeupMerge([row({ classId: null, makeup: true })], MINE).kind).toBe("separate");
  });

  it("이 강사가 안 가르치는 과목은 대상이 아니다 — 시수 2배(급여 과지급) 차단", () => {
    expect(planMakeupMerge([row({ subjectKey: "english" })], MINE).kind).toBe("separate");
  });

  it.each(["absent", "excused", "early_leave", "makeup"])(
    "시수를 올리면 안 되는 상태(%s)는 묻지 않고 분리",
    (raw) => {
      expect(planMakeupMerge([row({ attendanceRaw: raw })], MINE).kind).toBe("separate");
    },
  );

  it.each(["", "present", "late"])("합쳐도 되는 상태(%s)는 후보", (raw) => {
    expect(planMakeupMerge([row({ attendanceRaw: raw })], MINE).kind).toBe("ask");
  });

  it("🔴 출결이 없는 행의 '지금 값'은 수학 자동 시수다(화면 '타임'과 같게) — 기록이 있으면 저장값", () => {
    const empty = planMakeupMerge([row({ attendanceRaw: null, attendanceAutoUnits: 1.5 })], MINE);
    if (empty.kind !== "ask") throw new Error("후보가 있어야 한다");
    expect(empty.candidates[0]!.attendanceUnits).toBe(1.5);
    const recorded = planMakeupMerge([row({ attendanceRaw: "present", attendanceUnits: null, attendanceAutoUnits: 1.5 })], MINE);
    if (recorded.kind !== "ask") throw new Error("후보가 있어야 한다");
    expect(recorded.candidates[0]!.attendanceUnits).toBeNull(); // 강사가 찍은 1(null) — 자동값으로 바꾸지 않는다
  });

  it("이미 합쳐 둔 과목이 있으면 또 만들지 않는다(두 번 발송 방지)", () => {
    const plan = planMakeupMerge([row({ makeup: true })], MINE);
    expect(plan.kind).toBe("already");
    if (plan.kind === "already") expect(plan.subjects).toEqual(["수학"]);
  });
});

describe("mergeStatusOf / mergedUnits", () => {
  it("지각은 지각으로 보존 — 나머지는 출석", () => {
    expect(mergeStatusOf("late")).toBe("late");
    expect(mergeStatusOf(null)).toBe("present");
    expect(mergeStatusOf("present")).toBe("present");
  });

  it("수업타임은 미입력을 1로 보고 +1", () => {
    expect(mergedUnits(null)).toBe(2);
    expect(mergedUnits(1)).toBe(2);
    expect(mergedUnits(1.5)).toBe(2.5);
  });
});
