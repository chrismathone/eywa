import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStudentLearningMap } from "./learning-map-query";
import { learningMapFixture } from "../learning-map.test-fixture";
const mocks = vi.hoisted(() => ({ month: vi.fn(), learning: vi.fn() }));
vi.mock("@/features/math-sheets/server/month-queries", () => ({ getMathSheetMonth: mocks.month }));
vi.mock("@/features/math-sheets/server/learning-queries", () => ({ getMathLearningData: mocks.learning }));
beforeEach(() => vi.resetAllMocks());

describe("실제 진도맵 접근 배선", () => {
  it.each(["담당 반이 아닙니다", "반을 찾을 수 없습니다", "접근 권한이 없습니다"])("MCS 게이트 거절: %s", async error => {
    mocks.month.mockResolvedValue({ ok: false, error });
    expect(await getStudentLearningMap("other-class", "student", "2026-09")).toEqual({ status: "not-found" });
    expect(mocks.learning).not.toHaveBeenCalled();
  });
  it("허용된 반 주소에 다른 반 학생을 붙여도 학습 기록을 읽지 않는다", async () => {
    mocks.month.mockResolvedValue({ ok: true, data: { students: [{ studentId: "allowed" }] } });
    expect(await getStudentLearningMap("allowed-class", "foreign-student", null)).toEqual({ status: "not-found" });
    expect(mocks.learning).not.toHaveBeenCalled();
  });
  it("허용된 학생 한 명의 동일한 월 데이터를 그대로 공통 조회에 넘긴다", async () => {
    const f = learningMapFixture();
    const data = { className: f.className, month: f.month, students: [f.student] };
    mocks.month.mockResolvedValue({ ok: true, data });
    mocks.learning.mockResolvedValue({ status: "ok", goals: { [f.student.studentId]: f.goal }, progress: { [f.student.studentId]: f.progress }, records: { [f.student.studentId]: f.records } });
    const result = await getStudentLearningMap(f.classId, f.student.studentId, f.month);
    expect(result.status).toBe("ok");
    expect(mocks.month).toHaveBeenCalledWith(f.classId, f.month);
    expect(mocks.learning).toHaveBeenCalledWith(f.classId, data, { studentId: f.student.studentId, allRecords: true });
    if (result.status === "ok") expect(result.progress).toBe(f.progress);
  });
  it.each(["failed", "missing-table", "ok"])("조회 상태 %s를 샘플이나 0%%로 대체하지 않는다", async status => {
    const f = learningMapFixture();
    mocks.month.mockResolvedValue({ ok: true, data: { className: f.className, month: f.month, students: [f.student] } });
    mocks.learning.mockResolvedValue({ status, goals: {}, progress: {}, records: {} });
    const result = await getStudentLearningMap(f.classId, f.student.studentId, f.month);
    expect(result.status).toBe(status === "ok" ? "no-goal" : "failed");
    expect(result).not.toHaveProperty("progress");
  });
});
