import { beforeEach, describe, expect, it, vi } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  from: vi.fn(),
  save: vi.fn(),
  log: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("./access", () => ({ requireMcsClassAccess: mocks.access }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ operations: { holidays: [] } }),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { saveMathLearningGoals } from "./learning-actions";

const classId = "11111111-1111-4111-8111-111111111111",
  studentId = "22222222-2222-4222-8222-222222222222";
const tenantId = "tenant",
  userId = "user";
const blocks = flatLessons("중1");
const input = {
  classId,
  studentIds: [studentId],
  studyGrade: "중1",
  startBlock: blocks[0],
  endBlock: blocks[9],
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  textbook: null,
};
let rows: Record<string, unknown[]>;
let filters: Array<[string, string, unknown]>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({
    ok: true,
    access: { tenantId, classId, className: "수학반", user: { id: userId } },
  });
  mocks.save.mockResolvedValue({ error: null });
  rows = {
    class_schedules: [
      {
        day_of_week: "mon",
        start_time: "16:00",
        end_time: "17:00",
        valid_from: null,
        valid_to: null,
      },
    ],
    enrollments: [
      {
        student_id: studentId,
        start_date: "2026-01-01",
        end_date: null,
        is_transferred: false,
      },
    ],
    students: [{ id: studentId, withdrawn_at: null }],
  };
  filters = [];
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters.push([table, key, value]);
        return query;
      },
      in: () => query,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve),
      upsert: mocks.save,
    };
    return query;
  });
});

describe("전체 목표 저장 경계", () => {
  it("편집 권한이 없으면 테이블을 읽거나 쓰지 않는다", async () => {
    mocks.access.mockResolvedValue({
      ok: false,
      error: "편집 권한이 없습니다",
    });
    expect(await saveMathLearningGoals(input)).toEqual({
      ok: false,
      error: "편집 권한이 없습니다",
    });
    expect(mocks.access).toHaveBeenCalledWith(classId, { write: true });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("수강 명단에 없는 학생을 끼운 일괄 저장은 전부 거절한다", async () => {
    const result = await saveMathLearningGoals({
      ...input,
      studentIds: [studentId, "33333333-3333-4333-8333-333333333333"],
    });
    expect(result.ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("선택 기간에 수업이 없는 학생의 목표는 저장하지 않는다", async () => {
    rows.students = [{ id: studentId, withdrawn_at: "2026-07-31" }];
    expect((await saveMathLearningGoals(input)).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("서버에서도 블록 순서를 검증한다", async () => {
    expect(
      (await saveMathLearningGoals({ ...input, startBlock: blocks[10] })).ok,
    ).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("테넌트와 반을 명시하고 중복 학생은 한 번만 원자적으로 저장한다", async () => {
    expect(
      await saveMathLearningGoals({
        ...input,
        studentIds: [studentId, studentId],
      }),
    ).toEqual({ ok: true });
    expect(filters).toContainEqual(["class_schedules", "tenant_id", tenantId]);
    expect(filters).toContainEqual(["enrollments", "tenant_id", tenantId]);
    expect(filters).toContainEqual(["enrollments", "class_id", classId]);
    expect(filters).toContainEqual(["students", "tenant_id", tenantId]);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        tenant_id: tenantId,
        class_id: classId,
        student_id: studentId,
        updated_by: userId,
      }),
    ]);
    expect(mocks.revalidate).toHaveBeenCalledWith(`/mcs/${classId}/month`);
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mcs_learning_goal_save" }),
    );
  });
  it("DB 저장 실패를 성공으로 알리거나 새로고침하지 않는다", async () => {
    mocks.save.mockResolvedValue({ error: { code: "XX000" } });
    expect((await saveMathLearningGoals(input)).ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
