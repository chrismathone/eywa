import { beforeEach, describe, expect, it, vi } from "vitest";
import { canEditEnrollmentDatesNow, getEnrollmentDateAccess } from "./date-access";

const m = vi.hoisted(() => ({ user: vi.fn(), privileged: vi.fn(), readonly: vi.fn(), tenant: vi.fn(), menu: vi.fn(), settings: vi.fn(), scope: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.privileged }));
vi.mock("@/lib/auth/view-mode", () => ({ isReadonlyTeacherView: m.readonly }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: m.tenant }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: m.menu }));
vi.mock("@/features/students/server/read-scope", () => ({ teacherViewableClassIds: m.scope }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ id: "staff", systemRole: "admin" });
  m.privileged.mockResolvedValue(false); m.readonly.mockResolvedValue(false); m.tenant.mockResolvedValue(false); m.menu.mockResolvedValue("full"); m.scope.mockResolvedValue(["own-class"]);
  m.settings.mockResolvedValue({ permissions: { specialAccess: { enrollmentDateEditorIds: [] } } });
});
describe("수강 날짜 수정 공용 서버 게이트", () => {
  it("기능 지정이 없으면 일반 관리자도 거절하고 지정하면 허용한다", async () => {
    expect(await canEditEnrollmentDatesNow()).toBe(false);
    m.settings.mockResolvedValue({ permissions: { specialAccess: { enrollmentDateEditorIds: ["staff"] } } });
    expect(await canEditEnrollmentDatesNow()).toBe(true);
  });
  it("원장은 기존 자격을 유지한다", async () => {
    m.user.mockResolvedValue({ id: "master", systemRole: "master" }); expect(await canEditEnrollmentDatesNow()).toBe(true);
  });
  it("열람 전용 강사 전환·지점 보기에서는 지정되어도 수정하지 않는다", async () => {
    m.privileged.mockResolvedValue(true); m.readonly.mockResolvedValue(true); expect(await canEditEnrollmentDatesNow()).toBe(false);
    m.readonly.mockResolvedValue(false); m.tenant.mockResolvedValue(true); expect(await canEditEnrollmentDatesNow()).toBe(false);
  });
  it("명단만 지정하고 관련 메뉴가 모두 닫혔으면 허용하지 않는다", async () => {
    m.privileged.mockResolvedValue(true); m.menu.mockResolvedValue("none"); expect(await canEditEnrollmentDatesNow()).toBe(false);
  });
  it("미로그인·학생은 설정 조회 전 거절한다", async () => {
    m.user.mockResolvedValueOnce(null); expect(await canEditEnrollmentDatesNow()).toBe(false);
    m.user.mockResolvedValueOnce({ id: "student", systemRole: "student" }); expect(await canEditEnrollmentDatesNow()).toBe(false);
    expect(m.settings).not.toHaveBeenCalled();
  });
  it("강사뷰 — 명단·원장 판정·담당 반은 검증된 대상 강사로 본다(2026-11-05)", async () => {
    // '다른 강사 뷰'로 X를 열면 getCurrentUser({ teacherView: true })가 X — 실제 계정(원장)은 옵션 없이 부를 때만 나온다.
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? { id: "teacher-x", systemRole: "teacher" } : { id: "master", systemRole: "master" }));
    m.menu.mockResolvedValue("scoped");
    // 실제 계정이 원장이어도 대상 X가 지정되지 않았으면 닫힌다.
    expect(await canEditEnrollmentDatesNow()).toBe(false);
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    m.settings.mockResolvedValue({ permissions: { specialAccess: { enrollmentDateEditorIds: ["teacher-x"] } } });
    expect(await getEnrollmentDateAccess()).toEqual({ allowed: true, classIds: ["own-class"] });
    expect(m.scope).toHaveBeenCalledWith("teacher-x");
  });
  it("담당 메뉴만 있는 직원은 기능 지정으로 범위가 넓어지지 않는다", async () => {
    m.menu.mockResolvedValue("scoped"); m.privileged.mockResolvedValue(true);
    expect(await getEnrollmentDateAccess()).toEqual({ allowed: true, classIds: ["own-class"] });
    expect(m.scope).toHaveBeenCalledWith("staff");
    m.scope.mockRejectedValue(new Error("scope failed")); await expect(getEnrollmentDateAccess()).rejects.toThrow("scope failed");
  });
});
