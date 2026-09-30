import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { optimisticMarkFor } from "./attendance-mark";
import { makeupBaseUnitsOf, mergeStatusOf, mergedUnits, planMakeupMerge, type PlanSubject } from "./makeup-merge-plan";

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

  it.each(["absent", "excused", "makeup"])(
    "시수를 올리면 안 되는 상태(%s)는 묻지 않고 분리",
    (raw) => {
      expect(planMakeupMerge([row({ attendanceRaw: raw })], MINE).kind).toBe("separate");
    },
  );

  it.each(["", "present", "late", "early_leave"])("합쳐도 되는 상태(%s)는 후보", (raw) => {
    expect(planMakeupMerge([row({ attendanceRaw: raw })], MINE).kind).toBe("ask");
  });

  it("🔴 조퇴 칸(원장 2026-09-30) — 후보로 묻고, 합쳐도 조퇴를 조퇴로 되쓴다 · 시수는 기록값 + 보강", () => {
    const plan = planMakeupMerge([row({ attendanceRaw: "early_leave", attendanceUnits: 0.5, attendanceAutoUnits: 1.5 })], MINE);
    if (plan.kind !== "ask") throw new Error("조퇴 칸은 합칠 후보여야 한다");
    const c = plan.candidates[0]!;
    expect(c.attendanceRaw).toBe("early_leave");
    // 합친 수업타임의 '지금 값' = 조퇴로 줄여 둔 기록 시수(자동값으로 되돌리지 않는다)
    expect(c.attendanceUnits).toBe(0.5);
    expect(mergeStatusOf(c.attendanceRaw)).toBe("early_leave");
    // 보강 기본값은 정규 1회분(자동 시수) — 줄여 둔 조퇴 시수가 보강을 깎지 않는다
    expect(makeupBaseUnitsOf(c)).toBe(1.5);
  });

  it("조퇴 칸에 자동 시수가 없으면 보강 기본값은 null(=확인창 기본값) — 줄인 기록 시수를 쓰지 않는다", () => {
    const plan = planMakeupMerge([row({ attendanceRaw: "early_leave", attendanceUnits: 0.5 })], MINE);
    if (plan.kind !== "ask") throw new Error("후보가 있어야 한다");
    expect(makeupBaseUnitsOf(plan.candidates[0]!)).toBeNull();
  });

  it("조퇴가 아닌 칸의 보강 기본값은 종전대로 그 칸의 지금 시수", () => {
    const plan = planMakeupMerge([row({ attendanceRaw: "present", attendanceUnits: 1.5, attendanceAutoUnits: 2 })], MINE);
    if (plan.kind !== "ask") throw new Error("후보가 있어야 한다");
    expect(plan.candidates[0]!.makeupBaseUnits).toBeUndefined();
    expect(makeupBaseUnitsOf(plan.candidates[0]!)).toBe(1.5);
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
  it("지각은 지각, 조퇴는 조퇴로 보존 — 나머지는 출석", () => {
    expect(mergeStatusOf("late")).toBe("late");
    expect(mergeStatusOf("early_leave")).toBe("early_leave");
    expect(mergeStatusOf(null)).toBe("present");
    expect(mergeStatusOf("present")).toBe("present");
  });

  it("수업타임은 미입력을 1로 보고 +1", () => {
    expect(mergedUnits(null)).toBe(2);
    expect(mergedUnits(1)).toBe(2);
    expect(mergedUnits(1.5)).toBe(2.5);
  });
});

describe("조퇴 칸 합침 배선 — 조퇴가 출석으로 되쓰이지 않는다(원장 2026-09-30)", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("합침·추가 보강은 `mergeStatusOf(…attendanceRaw)`로 쓰고, 쓰기 함수가 조퇴를 받는다(메모는 안 보내 사유가 남는다)", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    expect(client).toContain("mergeStatusOf(merge.attendanceRaw)");
    expect(client).toContain("mergeStatusOf(target.attendanceRaw)");
    expect(client).toMatch(/status: BasicAttendance \| "early_leave"/);
    // 합침 쓰기는 시수만 보낸다 — note 키를 싣는 순간 조퇴 사유 메모가 지워진다.
    const merge = client.slice(client.indexOf("function mergeMakeupIntoRegular("), client.indexOf("function pendingMakeupRows("));
    expect(merge).toContain("{ units: String(units) }");
    expect(merge).not.toMatch(/note:/);
  });

  it("서버 셀 액션이 조퇴를 유효 상태로 받는다", () => {
    const actions = read("src/features/attendance/server/actions.ts");
    expect(actions).toMatch(/const STATUSES = \[[^\]]*"early_leave"/);
  });
});

describe("조퇴 쓰기는 학생 배지를 뒤집지 않는다(적대 리뷰 2026-09-30)", () => {
  it("🔴 영어 출석 + 수학 조퇴 학생에 합침 — 배지는 '출석' 그대로(조퇴를 '결석'으로 접지 않는다)", () => {
    expect(optimisticMarkFor("early_leave", "출석")).toBe("출석");
    expect(optimisticMarkFor("early_leave", "지각")).toBe("지각");
  });

  it("그 밖의 상태는 종전대로 그 상태의 배지", () => {
    expect(optimisticMarkFor("present", "결석")).toBe("출석");
    expect(optimisticMarkFor("late", "출석")).toBe("지각");
    expect(optimisticMarkFor("absent", "출석")).toBe("결석");
  });

  it("원스크린 쓰기·결석분 연결이 낙관 반영에 이 배지를 싣는다", () => {
    const client = readFileSync(join(process.cwd(), "src/features/onescreen/components/onescreen-client.tsx"), "utf8");
    const write = client.slice(client.indexOf("async function setAttendanceFor("), client.indexOf("async function applyQuickPresent("));
    expect(write).toContain("const myMark = optimisticMarkFor(status, prevMark);");
    expect(write).toMatch(/applyAttendanceLocal\([\s\S]*?\s+myMark,\s*\);/);
    expect(write).toContain("{ units: res.autoUnits }, myMark)");
    const link = client.slice(client.indexOf("async function linkMakeupAbsence("), client.indexOf("function addMakeupUnitsOnly("));
    expect(link).toContain("optimisticMarkFor(linkedRaw,");
  });
});
