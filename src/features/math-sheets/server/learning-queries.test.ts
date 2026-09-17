import { beforeEach, describe, expect, it, vi } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import type { MathSheetMonthData } from "./month-queries";

const mocks = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), records: vi.fn() }));
vi.mock("./access", () => ({ requireMcsClassAccess: mocks.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPagedInChunks: mocks.records }));
import { getMathLearningData } from "./learning-queries";

const topics = flatLessons("중1");
const studentId = "student";
const row = {
  student_id: studentId, study_grade: "중1", start_block: topics[0], end_block: topics[19],
  start_date: "2026-09-01", end_date: "2026-11-30", textbook: null,
};
const monthData = {
  month: "2026-09", today: "2026-09-17", students: [{ studentId }],
  learningContext: {
    schedules: ["mon", "wed", "thu"].map((dayOfWeek) => ({ dayOfWeek, startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null })),
    holidays: {}, spans: { [studentId]: [{ start: "2026-01-01", end: null }] },
  },
} as unknown as MathSheetMonthData;
let filters: unknown[][];
beforeEach(() => {
  vi.clearAllMocks();
  filters = [];
  mocks.access.mockResolvedValue({ ok: true, access: { tenantId: "tenant" } });
  mocks.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return query; },
      lte: (key: string, value: unknown) => { filters.push([table, "lte", key, value]); return query; },
      gte: (key: string, value: unknown) => { filters.push([table, "gte", key, value]); return query; },
      order: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, data: table === "math_learning_goals" ? [row] : [
        { ...row, track: "regular", block_count: 24 },
        { ...row, end_block: topics[0], end_date: "2026-09-30", track: "supplement", block_count: 4 },
        { ...row, student_id: "not-on-roster", track: "regular", block_count: 24 },
      ] }).then(resolve),
    };
    return query;
  });
  mocks.records.mockResolvedValue([
    { student_id: studentId, report_date: "2026-09-14", progress: topics[9], textbook: null },
    { student_id: studentId, report_date: "2026-09-16", progress: topics[0], textbook: null },
  ]);
});

describe("정규·수요일 계획 조회", () => {
  it("같은 학생의 두 계획과 기록을 분리하고 새 정규 계획을 우선한다", async () => {
    const data = await getMathLearningData("class", monthData);
    expect(data.status).toBe("ok");
    expect(data.progress[studentId].total).toBe(24);
    expect(data.progress[studentId].current).toBe(12);
    expect(data.supplement?.progress[studentId].total).toBe(4);
    expect(data.supplement?.progress[studentId].current).toBe(1);
    expect(data.records[studentId].map((record) => record.date)).toEqual(["2026-09-14"]);
    expect(data.supplement?.records[studentId].map((record) => record.date)).toEqual(["2026-09-16"]);
    expect(Object.keys(data.goals)).toEqual([studentId]);
    expect(mocks.records.mock.calls[0][0]).toEqual([studentId]);
    expect(filters).toContainEqual(["math_learning_track_goals", "tenant_id", "tenant"]);
    expect(filters).toContainEqual(["math_learning_track_goals", "class_id", "class"]);
    expect(filters).toContainEqual(["math_learning_track_goals", "lte", "start_date", "2026-09-30"]);
    expect(filters).toContainEqual(["math_learning_track_goals", "gte", "end_date", "2026-09-01"]);
  });
  it("권한 거절 시 학생 계획을 조회하지 않는다", async () => {
    mocks.access.mockResolvedValue({ ok: false });
    expect((await getMathLearningData("class", monthData)).status).toBe("failed");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.records).not.toHaveBeenCalled();
  });
  it("수업 기록 조회 실패는 0%가 아니라 읽기 실패로 반환한다", async () => {
    mocks.records.mockRejectedValue(new Error("unavailable"));
    const data = await getMathLearningData("class", monthData);
    expect(data.status).toBe("failed");
    expect(data.progress).toEqual({});
    expect(data.supplement?.progress).toEqual({});
  });
});
