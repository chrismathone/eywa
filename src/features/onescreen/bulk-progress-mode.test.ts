import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planBulkApply, type BulkTarget } from "./grid";

const row = (over: Partial<BulkTarget> = {}): BulkTarget =>
  ({
    studentId: "s1",
    subjectName: "수학",
    subjectIndex: 0,
    subjectKey: "math",
    today: "",
    progressMode: null,
    attitude: null,
    homework: "",
    textbook: "",
    homeworkToday: "",
    ...over,
  }) as BulkTarget;

describe("일괄 입력의 수업 성격(복습·문제풀이, 원장 2026-10-26)", () => {
  it("고른 과목 행에만 넣는다", () => {
    const plan = planBulkApply([row(), row({ studentId: "s2", subjectKey: "english" })], { progressMode: "복습" }, false, "math");
    expect(plan).toEqual([{ studentId: "s1", subjectName: "수학", subjectIndex: 0, set: { progressMode: "복습" } }]);
  });
  it("'빈 칸만'은 성격을 안 고른 행에만 · 목록 밖 값은 무시", () => {
    expect(planBulkApply([row({ progressMode: "문제풀이" })], { progressMode: "복습" }, true, "math")).toEqual([]);
    expect(planBulkApply([row()], { progressMode: "아무거나" }, false, "math")).toEqual([]);
  });
  it("일괄 입력 화면이 알약을 그리고 적용 결과를 행에 쓴다", () => {
    const panel = readFileSync(resolve(process.cwd(), "src/features/onescreen/components/bulk-apply.tsx"), "utf8");
    expect(panel).toMatch(/onMode=\{setLessonMode\}/);
    expect(panel).toMatch(/progressMode: lessonMode/);
    const client = readFileSync(resolve(process.cwd(), "src/features/onescreen/components/onescreen-client.tsx"), "utf8");
    expect(client).toMatch(/p\.set\.progressMode !== undefined\) setProgressModeFor/);
  });
});
