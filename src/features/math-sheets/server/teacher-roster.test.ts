import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  textbookReads: 0,
  pagedChunkReads: 0,
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "viewer", tenantId: "tenant", systemRole: "master" }),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => "full" }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ modules: { disabled: ["textbooks"] } }),
}));
vi.mock("./access", () => ({ mcsVisibleClassFilter: async () => null }));
vi.mock("@/features/textbooks/server/math-assignment-queries", () => ({
  getMathCatalogBooks: async () => { m.textbookReads += 1; return []; },
  getStudentBookOrders: async () => { m.textbookReads += 1; return new Map(); },
}));
vi.mock("@/features/textbooks/server/math-book-plan-queries", () => ({
  getMathBookTargets: async () => { m.textbookReads += 1; return { byStudent: new Map() }; },
}));
vi.mock("@/features/textbooks/server/school-exam-queries", () => ({
  getAllSchoolExamPeriods: async () => { m.textbookReads += 1; return { byKey: new Map() }; },
}));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPagedInChunks: async () => {
    m.pagedChunkReads += 1;
    return [{ class_id: "class", student_id: "student", start_date: null, end_date: null, is_transferred: false }];
  },
  fetchInChunks: async (ids: string[]) => ids[0] === "teacher"
    ? [{ id: "teacher", display_name: "담임" }]
    : [{ id: "student", name: "학생", school: "가람중", grade: "중2", withdrawn_at: null }],
}));
vi.mock("@/lib/supabase/db-error", () => ({ logDbError: vi.fn() }));

function classQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    or: () => query,
    order: () => query,
    then: (resolve: (value: unknown) => void) => Promise.resolve({
      data: [{ id: "class", class_name: "수학반", teacher_id: "teacher" }],
      error: null,
    }).then(resolve),
  };
  return query;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => classQuery() }) }));

import { getMathTeacherRoster } from "./teacher-roster";

beforeEach(() => {
  m.textbookReads = 0;
  m.pagedChunkReads = 0;
});

describe("MCS 선생님별 보기의 교재 모듈", () => {
  it("교재 모듈이 꺼지면 학생 명단만 읽고 교재 재료와 열 값은 만들지 않는다", async () => {
    const result = await getMathTeacherRoster();
    expect(result).toMatchObject({
      ok: true,
      textbooksOn: false,
      groups: [{ students: [{ window: null, status: null, difference: null, bookName: null, bookCount: 0 }] }],
    });
    expect(m.textbookReads).toBe(0);
    expect(m.pagedChunkReads).toBe(1);
  });
});
