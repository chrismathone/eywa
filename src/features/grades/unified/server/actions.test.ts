import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gradeWriteError: vi.fn(),
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  canEditStudent: vi.fn(),
  updateUnifiedGrade: vi.fn(),
  logAction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/features/grades/server/access", () => ({ gradeWriteError: mocks.gradeWriteError }));
vi.mock("@/features/grades/server/write", () => ({
  gradeMonthReady: vi.fn(),
  gradeNoExamReady: vi.fn(),
  updateUnifiedGrade: mocks.updateUnifiedGrade,
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: mocks.logAction }));
vi.mock("./scope", () => ({ canEditStudent: mocks.canEditStudent }));
vi.mock("./consultation", () => ({ addAcademicConsultation: vi.fn() }));

import { saveUnifiedGrade } from "./actions";

const gradeId = "123e4567-e89b-42d3-a456-426614174000";
const studentId = "123e4567-e89b-42d3-a456-426614174001";

function clearScoreForm(id = gradeId, date = "2026-09-22") {
  const form = new FormData();
  form.set("source", "grade");
  form.set("id", id);
  form.set("date", date);
  form.set("score", "");
  form.set("maxScore", "100");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gradeWriteError.mockResolvedValue(null);
  mocks.getCurrentUser.mockResolvedValue({ id: "staff", tenantId: "tenant" });
  mocks.canEditStudent.mockResolvedValue(true);
  mocks.updateUnifiedGrade.mockResolvedValue(null);
  mocks.createClient.mockResolvedValue({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: {
          id: gradeId,
          student_id: studentId,
          subject: "math",
          school_year: 2026,
          term: 2,
          exam_slot: "school",
          score: 50,
          max_score: 100,
          taken_on: "2026-09-22",
        }, error: null }),
      };
      return query;
    },
  });
});

it("clears an existing score with a standard five-part UUID", async () => {
  expect(await saveUnifiedGrade(undefined, clearScoreForm())).toEqual({ ok: true });
  expect(mocks.updateUnifiedGrade).toHaveBeenCalledWith("tenant", gradeId, {
    score: null,
    max_score: 100,
    taken_on: "2026-09-22",
  });
  expect(mocks.revalidatePath).toHaveBeenCalledWith("/exams");
});

it("distinguishes an invalid record ID from an invalid exam date", async () => {
  expect(await saveUnifiedGrade(undefined, clearScoreForm("not-an-id")))
    .toEqual({ error: "성적 기록을 확인해 주세요" });
  expect(await saveUnifiedGrade(undefined, clearScoreForm(gradeId, "2026-02-30")))
    .toEqual({ error: "시험일을 확인해 주세요" });
  expect(mocks.createClient).not.toHaveBeenCalled();
});
