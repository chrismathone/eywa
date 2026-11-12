import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ moduleOn: false, adminCalls: 0 }));
vi.mock("@/features/math-sheets/server/access", () => ({
  requireMcsClassAccess: async () => ({
    ok: true,
    access: { tenantId: "tenant", user: { id: "user" }, className: "수학반" },
  }),
}));
vi.mock("@/features/class-sheets/server/access", () => ({
  requireEcsClassAccess: async () => ({
    ok: true,
    access: { tenantId: "tenant", user: { id: "user" }, className: "영어반" },
  }),
}));
vi.mock("@/features/owner/server/modules", () => ({ isModuleOnForTenant: async () => m.moduleOn }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => { m.adminCalls += 1; throw new Error("꺼진 모듈에서 DB를 열면 안 됩니다"); },
}));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { saveMathTextbookAssignment } from "./math-assignment-actions";
import { saveMathBookTarget } from "./math-book-target-actions";
import { saveClassTextbookPlan } from "./plan-actions";
import { saveSchoolExamPeriods } from "./school-exam-actions";

const classId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const moduleOff = { ok: false, error: "이 학원은 교재목록 기능이 꺼져 있습니다" };

beforeEach(() => {
  m.moduleOn = false;
  m.adminCalls = 0;
});

describe("교재 쓰기 액션의 모듈 게이트", () => {
  it("반 계획·학생 배정·목표·학교별 내신기간을 모두 같은 문구로 서버에서 거절한다", async () => {
    const results = await Promise.all([
      saveMathTextbookAssignment({ classId, studentId, textbookId: null }),
      saveMathBookTarget({ classId, studentId, series: "공통수학", targetKey: null }),
      saveSchoolExamPeriods({ classId, school: "가람중", schoolYear: 2026, rows: [] }),
      saveClassTextbookPlan({
        classId,
        textbookId: "33333333-3333-4333-8333-333333333333",
        slotAxis: "class",
        pace: "period",
        termMode: "regular",
        startDate: "2026-11-12",
        startLessonNo: 1,
      }),
    ]);

    expect(results).toEqual([moduleOff, moduleOff, moduleOff, moduleOff]);
    expect(m.adminCalls).toBe(0);
  });
});
