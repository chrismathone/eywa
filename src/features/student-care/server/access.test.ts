import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), write: vi.fn(), visible: vi.fn(), from: vi.fn(), viewAs: vi.fn(), scope: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.access, canManageTenant: m.manage, canWriteTenant: m.write }));
vi.mock("./student-scope", () => ({ visibleCareStudents: m.visible }));
// 신규생 관리 권한의 범위(없음 · 담당 범위 · 지점 전체) — 판정은 newcomers/server/scope.ts(제 시험이 따로 있다).
vi.mock("@/features/newcomers/server/scope", () => ({ newcomerScopeOf: m.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
import { careAccess, careStorageMessage } from "./access";
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ id: "teacher", tenantId: "tenant", systemRole: "teacher" }); m.viewAs.mockResolvedValue(null);
  m.access.mockImplementation(async (_: string, key: string) => key === "students"); m.scope.mockResolvedValue("none");
  m.manage.mockResolvedValue(false); m.write.mockResolvedValue(false); m.visible.mockResolvedValue(new Set(["student"]));
});
function assigned(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error: null })) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.limit.mockReturnValue(q); m.from.mockReturnValue(q); return q;
}
describe("'다른 강사 뷰' = 그 사람(#154)", () => {
  it("신원은 보는 강사(teacherView)로 묻고, 강사뷰 대상이 있으면 proxy(본인 확인은 대신 안 함) · 없으면 아님", async () => {
    m.access.mockResolvedValue(true); m.scope.mockResolvedValue("all");
    m.viewAs.mockResolvedValue({ id: "teacher", tenantId: "tenant", systemRole: "teacher", access: "full" });
    expect((await careAccess()).actor.proxy).toBe(true);
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    m.viewAs.mockResolvedValue(null);
    expect((await careAccess()).actor.proxy).toBe(false);
  });
});
describe("담당자 한정 열람", () => {
  it("신규생 전체 권한 없이도 명시 배정된 약속만 읽는다", async () => {
    const q = assigned({ id: "promise" });
    const access = await careAccess("student");
    expect(access.readAll).toBe(false); expect(access.actor.canContribute).toBe(false);
    expect(q.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["student_id", "student"], ["owner_id", "teacher"]]);
  });
  it("🔴 강사에게 신규생 관리 '담당'을 연 학원 — 권한이 있어도 전체 열람이 아니다(자기에게 배정된 약속만 · 남이 맡은 약속은 못 읽는다)", async () => {
    // 강사는 이제 신규생 관리 권한이 **있다**(canAccess = true) — 그래도 범위가 담당이면 전체 열람이 아니다.
    m.access.mockResolvedValue(true); m.scope.mockResolvedValue("scoped"); m.write.mockResolvedValue(true);
    const q = assigned({ id: "promise" });
    const access = await careAccess("student");
    expect(m.scope).toHaveBeenCalledWith("teacher");
    expect(access.readAll).toBe(false);
    expect(q.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["student_id", "student"], ["owner_id", "teacher"]]);
    expect(m.visible).not.toHaveBeenCalled();
    // 목록 문(학생 없이)도 전체가 아니다 — 조회가 owner_id = 본인으로 좁힌다(queries.ts).
    expect((await careAccess()).readAll).toBe(false);
    // 배정이 없는 학생은 거절한다.
    assigned(null);
    await expect(careAccess("student")).rejects.toMatchObject({ reason: "denied" });
  });
  it("지점 전체로 읽는 계정('전체' · '읽기')만 전체 열람이다", async () => {
    m.user.mockResolvedValue({ id: "desk", tenantId: "tenant", systemRole: "counselor" }); m.scope.mockResolvedValue("all");
    expect((await careAccess("student")).readAll).toBe(true);
    expect(m.visible).toHaveBeenCalledWith(["student"]);
    expect(m.from).not.toHaveBeenCalled();
  });
  it("배정이 없으면 학생 이름이나 약속 본문을 읽기 전에 거부한다", async () => {
    assigned(null); await expect(careAccess("student")).rejects.toThrow("권한");
  });
  it("전체 열람 역할에도 기존 학생 범위를 적용하고 조회 실패 시 중단한다", async () => {
    m.access.mockResolvedValue(true); m.scope.mockResolvedValue("all"); m.visible.mockRejectedValue(new Error("조회 실패"));
    await expect(careAccess("student")).rejects.toThrow("조회 실패");
  });
  it("실패 까닭을 가른다 — 권한 밖 = denied · 표 없음(SQL 미적용) = unavailable", async () => {
    assigned(null);
    await expect(careAccess("student")).rejects.toMatchObject({ name: "CareAccessError", reason: "denied" });
    const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(async () => ({ data: null, error: { code: "PGRST205" } })) };
    q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.limit.mockReturnValue(q); m.from.mockReturnValue(q);
    await expect(careAccess("student")).rejects.toMatchObject({ reason: "unavailable", message: expect.stringContaining("아직 준비") });
    m.user.mockResolvedValue(null);
    await expect(careAccess("student")).rejects.toMatchObject({ reason: "denied" });
  });
  it("로그인·메뉴 접근을 확인하며 DB 내부 오류를 표시하지 않는다", async () => {
    m.user.mockResolvedValue(null); await expect(careAccess()).rejects.toThrow("로그인");
    expect(careStorageMessage({ code: "PGRST205" })).toContain("아직 준비");
    expect(careStorageMessage({ code: "42501" })).not.toContain("42501");
  });
});
