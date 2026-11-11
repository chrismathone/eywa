import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { planBulkApply, planCopyFirstRow, type BulkTarget, type CopyRowTarget } from "./grid";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "./components/onescreen-screen-source.test-util";

// 원장 2026-10-27 *"표모드에서 일괄입력 및 작성 — 카드에선 들어가고 표에선 안 된다거나 불편한 부분"* 점검에서 나온 셋.
const row = (over: Partial<BulkTarget> = {}): BulkTarget =>
  ({
    studentId: "s1",
    subjectName: "수학",
    subjectIndex: 0,
    subjectKey: "math",
    today: "",
    attitude: null,
    attitudeNoteOk: true,
    homework: "",
    textbook: "",
    homeworkToday: "",
    ...over,
  }) as BulkTarget;
const SICK = { reason: "sick" as const, detail: "" };

describe("일괄 입력 — 일일 테스트 '시험 없음'", () => {
  it("새 수학 보고서 행에만 · 사유는 선택(원장 2026-10-27 — 안 고른 값도 넣는다)", () => {
    expect(planBulkApply([row(), row({ studentId: "e", attitudeNoteOk: false })], { dailyTestSkip: SICK }, false)).toEqual([
      { studentId: "s1", subjectName: "수학", subjectIndex: 0, set: { dailyTestSkip: SICK } },
    ]);
    expect(planBulkApply([row()], { dailyTestSkip: { reason: null, detail: "" } }, false)).toEqual([
      { studentId: "s1", subjectName: "수학", subjectIndex: 0, set: { dailyTestSkip: { reason: null, detail: "" } } },
    ]);
  });
  it("'시험 없음'과 함께 온 일일 점수는 넣지 않는다", () => {
    const [p] = planBulkApply([row()], { dailyTestSkip: SICK, dailyScore: 8 }, false);
    expect(p!.set).toEqual({ dailyTestSkip: SICK });
  });
  it("'빈 칸만' — 점수가 있거나 이미 '시험 없음'인 행은 건드리지 않는다", () => {
    expect(planBulkApply([row({ dailyScore: 7 })], { dailyTestSkip: SICK }, true)).toEqual([]);
    expect(planBulkApply([row({ dailyTestSkip: { reason: "slow", detail: "" } })], { dailyTestSkip: SICK }, true)).toEqual([]);
    expect(planBulkApply([row({ dailyTestSkip: { reason: "slow", detail: "" } })], { dailyScore: 9 }, true)).toEqual([]);
  });
  it("점수를 덮어 넣는 '시험 없음' 행은 '시험 있음'으로 되돌린다(안 그러면 점수가 안 읽힌다)", () => {
    const [p] = planBulkApply([row({ dailyTestSkip: { reason: "slow", detail: "" } })], { dailyScore: 9 }, false);
    expect(p!.set).toEqual({ dailyScore: 9, dailyTestSkip: null });
  });
});

describe("일괄 입력 — 숙제 미제출 사유", () => {
  it("결과 숙제가 미제출인 새 수학 보고서 행에만", () => {
    const plan = planBulkApply(
      [row(), row({ studentId: "s2", homework: "미제출" }), row({ studentId: "e", homework: "미제출", attitudeNoteOk: false })],
      { homeworkMissReason: "학원 행사" },
      false,
    );
    expect(plan.map((p) => [p.studentId, p.set])).toEqual([["s2", { homeworkMissReason: "학원 행사" }]]);
  });
  it("이번에 미제출로 바꾸는 행에도 · '빈 칸만'은 사유가 빈 행에만", () => {
    expect(planBulkApply([row()], { homework: "미제출", homeworkMissReason: "x" }, false)[0]!.set).toEqual({ homework: "미제출", homeworkMissReason: "x" });
    expect(planBulkApply([row({ homework: "미제출", homeworkMissReason: "있음" })], { homeworkMissReason: "x" }, true)).toEqual([]);
  });
});

describe("맨 위 행 복사 — 복습·문제풀이도 진도와 함께", () => {
  const target = (over: Partial<CopyRowTarget> = {}): CopyRowTarget => ({
    studentId: "s2", subjectName: "수학", subjectIndex: 0, subjectKey: "math", today: "", textbook: "", homeworkToday: "", actionable: true, ...over,
  });
  const src = { subjectKey: "math", today: "소인수분해", progressMode: "복습", textbook: "", homeworkToday: "" };
  it("진도와 함께 옮긴다 · '빈 칸만'은 성격을 안 고른 행에만", () => {
    expect(planCopyFirstRow(src, [target()], { overwrite: false }).plan[0]!.set).toEqual({ today: "소인수분해", progressMode: "복습" });
    expect(planCopyFirstRow(src, [target({ today: "x", progressMode: "문제풀이" })], { overwrite: false }).plan).toEqual([]);
    expect(planCopyFirstRow(src, [target({ today: "x", progressMode: "문제풀이" })], { overwrite: true }).plan[0]!.set.progressMode).toBe("복습");
  });
  it("진도 없는 성격은 옮기지 않는다", () => {
    expect(planCopyFirstRow({ ...src, today: "" }, [target()], { overwrite: true }).plan).toEqual([]);
  });
});

describe("배선", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  it("화면이 새 값을 행에 쓴다", () => {
    const client = readOnescreenScreen();
    expect(client).toMatch(/p\.set\.dailyTestSkip !== undefined\) setTestSkipFor/);
    expect(client).toMatch(/p\.set\.homeworkMissReason !== undefined\) setHomeworkMissReasonFor/);
    expect(client).toMatch(/progressMode: first\.subject\.progressMode/);
    const panel = read("src/features/onescreen/components/bulk-apply.tsx");
    expect(panel).toContain("<DailyTestSkipPanel");
    expect(panel).toContain("<HomeworkMissReasonInput");
  });
});
