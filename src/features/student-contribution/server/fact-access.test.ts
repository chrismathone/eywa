import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), level: vi.fn(), classes: vi.fn(), rows: vi.fn(), admin: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.level }));
vi.mock("@/features/students/server/read-scope", () => ({ teacherViewableClassIds: m.classes, READ_GRACE_DAYS: 60 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPagedInChunks: m.rows }));
import { readableFactStudents } from "./fact-access";
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "teacher", tenantId: "t", systemRole: "teacher" });
  m.level.mockResolvedValue("scoped"); m.classes.mockResolvedValue(["c"]); m.rows.mockResolvedValue([{ student_id: "own" }]); });
it("기여도 권한이 있어도 학생 메뉴 차단이면 학생 원본은 없음", async () => {
  m.level.mockResolvedValue("none"); expect(await readableFactStudents()).toEqual(new Set()); expect(m.admin).not.toHaveBeenCalled();
});
it("담당 범위와 열람 전용 강사 보기에서도 담당 학생만", async () => {
  expect(await readableFactStudents()).toEqual(new Set(["own"]));
  m.level.mockResolvedValue("readonly"); expect(await readableFactStudents()).toEqual(new Set(["own"]));
  expect(m.user).toHaveBeenCalledWith({ teacherView: true }); expect(m.classes).toHaveBeenCalledWith("teacher");
});
it("원장의 전체 학생 열람은 별도 담당 조회 없이 전체", async () => {
  m.user.mockResolvedValue({ id: "owner", tenantId: "t", systemRole: "master" }); m.level.mockResolvedValue("full");
  expect(await readableFactStudents()).toBeNull(); expect(m.rows).not.toHaveBeenCalled();
});
