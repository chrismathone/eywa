import { beforeEach, describe, expect, it, vi } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import { buildLearningProgress, goalMilestones, planLearningGoal, type LearningData } from "../lib/learning-plan";

const mocks = vi.hoisted(() => ({ access: vi.fn(), month: vi.fn(), learning: vi.fn(), update: vi.fn(), log: vi.fn(), revalidate: vi.fn(), filters: [] as [string, unknown][] }));
vi.mock("./access", () => ({ requireMcsClassAccess: mocks.access }));
vi.mock("./month-queries", () => ({ getMathSheetMonth: mocks.month }));
vi.mock("./learning-queries", () => ({ getMathLearningData: mocks.learning }));
vi.mock("@/lib/date-kst", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/date-kst")>(), kstToday: () => "2026-10-08" }));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update: mocks.update }) }) }));
import { loadMathLearningGoalRevision, reviseMathLearningGoal } from "./learning-revision-actions";

const classId = "11111111-1111-4111-8111-111111111111", studentId = "22222222-2222-4222-8222-222222222222";
let data: LearningData;
let savedResult: { data: unknown[] | null; error: object | null };
beforeEach(() => {
  vi.clearAllMocks(); mocks.filters.length = 0;
  const goal = { ...planLearningGoal({ studentId, studyGrade: "중1", startBlock: flatLessons("중1")[0], endBlock: flatLessons("중1").at(-1)!,
    startDate: "2026-09-01", endDate: "2027-02-28", textbook: null, track: "regular" }), updatedAt: "version" };
  const context = { schedules: [{ dayOfWeek: "wed", startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null }], holidays: {}, spans: { [studentId]: [{ start: "2026-09-01", end: null }] } };
  const progress = buildLearningProgress(goal, context, [{ date: "2026-10-07", progress: flatLessons("중1")[3], textbook: null }], "2026-10-08");
  data = { goals: { [studentId]: goal }, progress: { [studentId]: progress }, context, records: {}, status: "ok", track: "regular", referenceDate: "2026-10-08" };
  mocks.access.mockResolvedValue({ ok: true, access: { tenantId: "tenant", classId, className: "합성 반", user: { id: "actor" } } });
  mocks.month.mockResolvedValue({ ok: true, data: { students: [{ studentId }] } });
  mocks.learning.mockImplementation(async () => data);
  savedResult = { data: [{ student_id: studentId }], error: null };
  const query = { eq: (key: string, value: unknown) => { mocks.filters.push([key, value]); return query; }, select: async () => savedResult };
  mocks.update.mockReturnValue(query);
});
function input() {
  const goal = data.goals[studentId], progress = data.progress[studentId];
  return { classId, studentId, startDate: goal.startDate, track: "regular" as const, updatedAt: goal.updatedAt!, expectedCurrentBlock: progress.currentBlock,
    expectedCurrentDate: progress.currentDate, textbook: "수정 교재", milestones: goalMilestones(goal).map(stop => ({ ...stop, endDate: "2026-12-31", blockCount: 20 })) };
}

describe("남은 목표 저장 권한·동시 수정·배선", () => {
  it("편집 권한 없이는 최신 자료를 조회하거나 저장하지 않는다", async () => {
    mocks.access.mockResolvedValue({ ok: false, error: "편집 권한이 없습니다" });
    expect((await loadMathLearningGoalRevision(input())).ok).toBe(false);
    expect((await reviseMathLearningGoal(input())).ok).toBe(false);
    expect(mocks.month).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("서버가 최신 계획과 오늘 진도로 재배분하고 학생·지점·반·유형·시작월·버전을 모두 지정한다", async () => {
    expect(await reviseMathLearningGoal(input())).toEqual({ ok: true });
    expect(mocks.month).toHaveBeenCalledWith(classId, "2026-10");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ end_date: "2026-12-31", block_count: 20,
      plan_revision: expect.objectContaining({ effectiveDate: "2026-10-08", anchor: { grade: "중1", lesson: flatLessons("중1")[3] } }), updated_by: "actor" }));
    expect(mocks.filters).toEqual(expect.arrayContaining([["tenant_id", "tenant"], ["class_id", classId], ["student_id", studentId], ["track", "regular"], ["start_date", "2026-09-01"], ["updated_at", "version"]]));
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ action: "mcs_learning_goal_revise" }));
    expect(mocks.revalidate).toHaveBeenCalledWith(`/mcs/${classId}/month`);
  });
  it.each(["updatedAt", "expectedCurrentBlock", "expectedCurrentDate"] as const)("오래된 %s 값으로 덮어쓰지 않는다", async field => {
    expect((await reviseMathLearningGoal({ ...input(), [field]: "old" })).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("현재 목표가 없는 학생과 다른 시작월의 목표는 갱신하지 않는다", async () => {
    expect((await reviseMathLearningGoal({ ...input(), studentId: "33333333-3333-4333-8333-333333333333" })).ok).toBe(false);
    expect((await reviseMathLearningGoal({ ...input(), startDate: "2026-08-01" })).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("자료 조회 실패와 수업이 없는 구간은 빈 계획으로 저장하지 않는다", async () => {
    data.status = "failed";
    expect((await reviseMathLearningGoal(input())).ok).toBe(false);
    data.status = "ok"; data.context.spans[studentId] = [{ start: "2026-09-01", end: "2026-10-08" }];
    expect((await reviseMathLearningGoal(input())).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("버전·진도가 같아도 반의 유형이 바뀌면 이전 유형의 초안을 저장하지 않는다", async () => {
    const value = input(); data.goals[studentId].track = "supplement"; data.track = "supplement";
    expect((await reviseMathLearningGoal(value)).ok).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("저장 직전 동시 수정과 DB 오류를 성공으로 알리거나 갱신하지 않는다", async () => {
    savedResult = { data: [], error: null };
    expect((await reviseMathLearningGoal(input())).ok).toBe(false);
    savedResult = { data: null, error: { code: "XX000" } };
    expect((await reviseMathLearningGoal(input())).ok).toBe(false);
    expect(mocks.log).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
