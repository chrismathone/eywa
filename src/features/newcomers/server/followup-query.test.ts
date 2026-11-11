import { beforeEach, expect, it, vi } from "vitest";
import { followupAccess, getFollowupSource, getFollowupView } from "./followup-query";
import { fixture, managerId, studentId, teacherId } from "../followup-fixtures.test-support";

const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), write: vi.fn(), level: vi.fn(), load: vi.fn(),
  tables: {} as Record<string, unknown[]>, calls: [] as { table: string; method: string; args: unknown[] }[], failed: "" }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.access, canWriteTenant: m.write, accessLevelTenant: m.level }));
vi.mock("./queries", () => ({ getNewcomers: m.load, loadNewcomers: m.load }));
vi.mock("@/lib/date-kst", async original => ({ ...await original<typeof import("@/lib/date-kst")>(), kstToday: () => "2026-11-11" }));
function db() {
  return { from: (table: string) => {
    const query: unknown = new Proxy({}, { get: (_, method) => method === "then"
      ? (resolve: (value: unknown) => unknown) => Promise.resolve({ data: m.tables[table] ?? [], error: m.failed === table ? { message: "read failed" } : null }).then(resolve)
      : (...args: unknown[]) => { m.calls.push({ table, method: String(method), args }); return query; } });
    return query;
  } };
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db() }));
beforeEach(() => {
  vi.clearAllMocks(); m.calls = []; m.failed = "";
  m.user.mockResolvedValue({ id: managerId, tenantId: "tenant-a", systemRole: "admin" });
  m.access.mockResolvedValue(true); m.write.mockResolvedValue(true); m.level.mockResolvedValue("write");
  m.load.mockResolvedValue(fixture().legacy);
  m.tables = {
    enrollments: [{ student_id: studentId, class_id: "math-class", start_date: "2026-10-01", end_date: null }, { student_id: studentId, class_id: "english-class", start_date: "2026-10-01", end_date: null }],
    classes: [{ id: "math-class", subject: "math", teacher_id: teacherId, is_active: true }, { id: "english-class", subject: "english", teacher_id: "other-teacher", is_active: true }],
    users: [{ id: managerId, display_name: "허은진", status: "active", system_role: "admin" }, { id: teacherId, display_name: "수학담임", status: "active", system_role: "teacher" }, { id: "english-manager", display_name: "정유진", status: "active", system_role: "admin" }],
    student_onboarding_manager_defaults: [{ subject: "math", manager_id: managerId }, { subject: "english", manager_id: "english-manager" }],
    student_onboarding_checks: [{ student_id: studentId, subject: "math", item_key: "month1_call", done_by: managerId, memo: "수행: 적응 전화\n결과: 잘 적응", consultation_id: null }],
  };
});
it("실제 과목 기본 관리자와 완료 근거를 한 학생에 연결하고 지점으로 조회한다", async () => {
  const { data } = await getFollowupView(fixture().legacy);
  expect(data.error).toBeNull(); expect(data.students).toHaveLength(1);
  expect(data.students[0].managers.map(r => r.manager?.name)).toEqual(["허은진", "정유진"]);
  expect(data.students[0].evidence["math|month1_call"]).toMatchObject({ doneByName: "허은진", memo: "수행: 적응 전화\n결과: 잘 적응" });
  expect(m.calls).toContainEqual({ table: "student_onboarding_subject_assignments", method: "eq", args: ["tenant_id", "tenant-a"] });
  expect(m.calls.some(c => c.table === "student_onboarding_assignments")).toBe(false);
});
it("강사는 본인 담당 과목과 학생만 조회하고 관리자 배정을 수정할 수 없다", async () => {
  m.user.mockResolvedValue({ id: teacherId, tenantId: "tenant-a", systemRole: "teacher" }); m.level.mockResolvedValue("scoped");
  const { data, legacy } = await getFollowupView(fixture().legacy);
  expect(data.canManage).toBe(false); expect(data.staff).toEqual([]);
  expect(legacy.subjectRows.map(r => r.subject)).toEqual(["math"]);
  expect(data.students[0].subjects.map(r => r.subject)).toEqual(["math"]);
});
it("자료 조회 실패를 미지정·0건으로 확정하지 않고 저장을 잠근다", async () => {
  m.failed = "student_onboarding_subject_assignments";
  const { data } = await getFollowupView(fixture().legacy);
  expect(data.error).toBeTruthy(); expect(data.canManage).toBe(false); expect(data.canReport).toBe(false);
  // 종전 '전체 완료 체크표'의 쓰기는 이 실패로 잠기지 않는다(따로 판정).
  expect(data.canWriteChecks).toBe(true);
});
it("90일 이후 미해결 피드백 학생도 계속 관리하고 메뉴 권한 없이 조회하지 않는다", async () => {
  m.tables.student_onboarding_feedback = [{ student_id: studentId }];
  await getFollowupSource();
  expect(m.load).toHaveBeenCalledWith(expect.anything(), "2026-11-11", "tenant-a", [studentId], true);
  m.access.mockResolvedValue(false);
  await expect(followupAccess()).rejects.toThrow("권한");
});
