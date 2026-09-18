import { beforeEach, describe, expect, it, vi } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  canReset: vi.fn(),
  from: vi.fn(),
  save: vi.fn(),
  log: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("./access", () => ({
  requireMcsClassAccess: mocks.access,
  canResetMathLearningGoals: mocks.canReset,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ operations: { holidays: [] } }),
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.log }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { resetMathLearningGoals, saveMathLearningGoals } from "./learning-actions";

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
let deleted: string[];
/** delete().select()가 돌려줄 행 — 기본은 "한 건 지워졌다". */
const deleteRows: Record<string, unknown[]> = {
  math_learning_track_goals: [{ student_id: "22222222-2222-4222-8222-222222222222" }],
  math_learning_goals: [],
};
const deleteErrors: Record<string, { code: string } | null> = {};
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
  deleted = [];
  mocks.canReset.mockResolvedValue(true);
  mocks.from.mockImplementation((table: string) => {
    let deleting = false;
    const query = {
      select: () => query,
      delete: () => {
        deleting = true;
        deleted.push(table);
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.push([deleting ? `${table}:delete` : table, key, value]);
        return query;
      },
      in: () => query,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: deleting ? (deleteRows[table] ?? []) : (rows[table] ?? []),
          error: deleteErrors[table] ?? null,
        }).then(resolve),
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
  it("새 정규 계획은 24블록으로 저장하고 기존 목표 표를 덮지 않는다", async () => {
    expect((await saveMathLearningGoals({ ...input, track: "regular", blockCount: 24, endDate: "2026-10-31" })).ok).toBe(true);
    expect(mocks.from).toHaveBeenCalledWith("math_learning_track_goals");
    expect(mocks.from).not.toHaveBeenCalledWith("math_learning_goals");
    expect(mocks.save.mock.calls[0][0][0]).toMatchObject({ track: "regular", block_count: 24 });
    expect(mocks.save.mock.calls[0][1]).toEqual({ onConflict: "tenant_id,class_id,student_id,track,start_date" });
  });
  it("수요일 일정이 없는 반에는 복습 목표를 저장하지 않는다", async () => {
    expect((await saveMathLearningGoals({ ...input, track: "supplement", blockCount: 4 })).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("수요일 4블록은 정규 계획과 별도 키로 저장한다", async () => {
    rows.class_schedules = [{ ...(rows.class_schedules[0] as object), day_of_week: "wed" }];
    expect((await saveMathLearningGoals({ ...input, track: "supplement", blockCount: 4 })).ok).toBe(true);
    expect(mocks.save.mock.calls[0][0][0]).toMatchObject({ track: "supplement", block_count: 4 });
    expect(mocks.save.mock.calls[0][1].onConflict).toContain("track");
  });
  it("정규 목표에 4블록을 위조하면 저장 전에 거절한다", async () => {
    expect((await saveMathLearningGoals({ ...input, track: "regular", blockCount: 4 })).ok).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});

const resetInput = {
  classId,
  studentIds: [studentId],
  track: "regular" as const,
  startDate: "2026-09-01",
  standard: true,
};

describe("전체 목표 초기화(배정 취소) — 원장 이상급", () => {
  beforeEach(() => {
    deleteRows.math_learning_track_goals = [{ student_id: studentId }];
    deleteRows.math_learning_goals = [];
    delete deleteErrors.math_learning_track_goals;
    delete deleteErrors.math_learning_goals;
  });

  it("🔴 편집 권한이 있어도 원장이 아니면 한 행도 지우지 않는다", async () => {
    mocks.canReset.mockResolvedValue(false);
    expect(await resetMathLearningGoals(resetInput)).toEqual({
      ok: false,
      error: "전체 목표 초기화는 원장만 할 수 있습니다.",
    });
    expect(deleted).toEqual([]);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("MCS 게이트가 막으면 권한 확인까지 가지 않는다", async () => {
    mocks.access.mockResolvedValue({ ok: false, error: "담당 반이 아닙니다" });
    expect((await resetMathLearningGoals(resetInput)).ok).toBe(false);
    expect(mocks.canReset).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("🔴 표준 계획은 (구분·시작월)까지 좁혀 그 한 칸만 지운다", async () => {
    expect(await resetMathLearningGoals(resetInput)).toEqual({ ok: true, removed: 1 });
    expect(filters).toContainEqual(["math_learning_track_goals:delete", "tenant_id", tenantId]);
    expect(filters).toContainEqual(["math_learning_track_goals:delete", "class_id", classId]);
    expect(filters).toContainEqual(["math_learning_track_goals:delete", "track", "regular"]);
    expect(filters).toContainEqual(["math_learning_track_goals:delete", "start_date", "2026-09-01"]);
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mcs_learning_goal_reset" }),
    );
    expect(mocks.revalidate).toHaveBeenCalledWith(`/mcs/${classId}/month`);
  });

  it("🔴 옛 목표 표도 함께 지운다 — 안 지우면 읽기 폴백으로 곧바로 되살아난다", async () => {
    expect(deleted).toEqual([]);
    await resetMathLearningGoals(resetInput);
    expect(deleted).toEqual(["math_learning_track_goals", "math_learning_goals"]);
  });

  it("🔴 수요일 복습 초기화는 옛 표(정규)를 건드리지 않는다", async () => {
    await resetMathLearningGoals({ ...resetInput, track: "supplement" });
    expect(deleted).toEqual(["math_learning_track_goals"]);
  });

  it("지운 게 없으면 성공이라 말하지 않는다(새로고침·감사로그도 없다)", async () => {
    deleteRows.math_learning_track_goals = [];
    expect(await resetMathLearningGoals(resetInput)).toEqual({
      ok: false,
      error: "초기화할 전체 목표가 없습니다.",
    });
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("표가 아직 없는 환경은 실패가 아니다 — 다른 한쪽만 지운다([[#95]])", async () => {
    deleteRows.math_learning_track_goals = [];
    deleteErrors.math_learning_track_goals = { code: "42P01" };
    deleteRows.math_learning_goals = [{ student_id: studentId }];
    expect(await resetMathLearningGoals(resetInput)).toEqual({ ok: true, removed: 1 });
  });

  it("진짜 DB 오류는 성공으로 알리지 않는다", async () => {
    deleteErrors.math_learning_track_goals = { code: "XX000" };
    expect((await resetMathLearningGoals(resetInput)).ok).toBe(false);
    expect(mocks.log).not.toHaveBeenCalled();
  });
});
