/** 일괄 입력의 '지난 영상 숙제 검사' 대상 — 화면에 검사 칸이 보이는 행만(2026-10-02). */
import { describe, expect, it } from "vitest";
import { assignmentKey } from "./assignment";
import { countCheckOverwrites, hasVideoCheckCell, planBulkVideoCheck, type BulkCheckContext, type BulkCheckRow } from "./bulk-check";
import { DEFAULT_VIDEO_HOMEWORK_POLICY } from "./policy";

const row = (over: Partial<BulkCheckRow> = {}): BulkCheckRow =>
  ({ classId: "c1", studentId: "s1", subjectKey: "math", grade: "중1", homeworkDate: "2026-09-29", ...over });
const ctx = (over: Partial<BulkCheckContext> = {}): BulkCheckContext =>
  ({ policy: DEFAULT_VIDEO_HOMEWORK_POLICY, assignments: {}, marks: [], ...over });
const submitted = { status: "submitted" as const, onlyEmpty: false };

describe("검사 칸이 보이는 행인가 — VideoHomeworkCheck와 같은 조건", () => {
  it("반 없음·정책이 끈 반은 칸이 없다", () => {
    expect(hasVideoCheckCell(row({ classId: null }), ctx())).toBe(false);
    expect(hasVideoCheckCell(row(), ctx({ policy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY, enabled: false } }))).toBe(false);
    expect(hasVideoCheckCell(row(), ctx({ policy: { ...DEFAULT_VIDEO_HOMEWORK_POLICY, disabledClassIds: ["c1"] } }))).toBe(false);
    expect(hasVideoCheckCell(row(), ctx())).toBe(true);
  });
  it("지난 수업이 '영상 과제 없음'이면 칸이 없다 — 단 이미 찍은 기록이 있으면 남는다", () => {
    const assignments = { [assignmentKey("s1", "2026-09-29", "c1")]: false };
    expect(hasVideoCheckCell(row(), ctx({ assignments }))).toBe(false);
    expect(hasVideoCheckCell(row(), ctx({ assignments, marks: [{ classId: "c1", studentId: "s1", status: "missing" }] }))).toBe(true);
    // 모름(키 없음)·지난 수업일 모름은 예전처럼 칸이 뜬다
    expect(hasVideoCheckCell(row({ homeworkDate: null }), ctx({ assignments }))).toBe(true);
  });
});

describe("찍을 칸", () => {
  it("칸이 없는 행은 빠지고 · 같은 (반 × 학생)은 한 번만", () => {
    const plan = planBulkVideoCheck([row(), row(), row({ studentId: "s2", classId: null }), row({ studentId: "s3" })], ctx(), submitted);
    expect(plan).toEqual([
      { classId: "c1", studentId: "s1", homeworkDate: "2026-09-29" },
      { classId: "c1", studentId: "s3", homeworkDate: "2026-09-29" },
    ]);
  });
  it("이미 같은 값인 칸은 건너뛰고 · 다른 값은 고친다 · '빈 칸만'이면 찍힌 칸은 전부 건너뛴다", () => {
    const marks = [
      { classId: "c1", studentId: "s1", status: "submitted" as const },
      { classId: "c1", studentId: "s2", status: "missing" as const },
    ];
    const rows = [row(), row({ studentId: "s2" }), row({ studentId: "s3" })];
    expect(planBulkVideoCheck(rows, ctx({ marks }), submitted).map((c) => c.studentId)).toEqual(["s2", "s3"]);
    expect(planBulkVideoCheck(rows, ctx({ marks }), { status: "submitted", onlyEmpty: true }).map((c) => c.studentId)).toEqual(["s3"]);
  });
  it("지난 수업일을 모르면 null로 보낸다(옛 기록과 같은 자리)", () => {
    expect(planBulkVideoCheck([row({ homeworkDate: undefined })], ctx(), submitted)).toEqual([{ classId: "c1", studentId: "s1", homeworkDate: null }]);
  });
  it("🔴 지난 수업일을 모르는 행은 이미 찍힌 기록의 숙제일을 지킨다 — null로 덮으면 장부의 그 회차에서 기록이 떨어진다", () => {
    const marks = [{ classId: "c1", studentId: "s1", status: "missing" as const, homeworkDate: "2026-09-26" }];
    expect(planBulkVideoCheck([row({ homeworkDate: undefined })], ctx({ marks }), submitted))
      .toEqual([{ classId: "c1", studentId: "s1", homeworkDate: "2026-09-26" }]);
    // 행이 지난 수업일을 알면 그 값이 이긴다(한 칸 저장과 같다)
    expect(planBulkVideoCheck([row()], ctx({ marks }), submitted)[0]!.homeworkDate).toBe("2026-09-29");
  });
  it("바꾸는 칸 수 — 이미 찍힌 기록이 있는 대상만 센다(적용 전 확인 문구의 숫자)", () => {
    const marks = [{ classId: "c1", studentId: "s2", status: "missing" as const }];
    const targets = planBulkVideoCheck([row(), row({ studentId: "s2" }), row({ studentId: "s3" })], ctx({ marks }), submitted);
    expect(targets).toHaveLength(3);
    expect(countCheckOverwrites(targets, { marks })).toBe(1);
    expect(countCheckOverwrites(planBulkVideoCheck([row(), row({ studentId: "s2" })], ctx({ marks }), { status: "submitted", onlyEmpty: true }), { marks })).toBe(0);
  });
});
