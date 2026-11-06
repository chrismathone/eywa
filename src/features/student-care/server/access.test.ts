import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), manage: vi.fn(), write: vi.fn(), visible: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.access, canManageTenant: m.manage, canWriteTenant: m.write }));
vi.mock("./student-scope", () => ({ visibleCareStudents: m.visible }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
import { careAccess, careStorageMessage } from "./access";
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ id: "teacher", tenantId: "tenant", systemRole: "teacher" });
  m.access.mockImplementation(async (_: string, key: string) => key === "students");
  m.manage.mockResolvedValue(false); m.write.mockResolvedValue(false); m.visible.mockResolvedValue(new Set(["student"]));
});
function assigned(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error: null })) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.limit.mockReturnValue(q); m.from.mockReturnValue(q); return q;
}
describe("담당자 한정 열람", () => {
  it("신규생 전체 권한 없이도 명시 배정된 약속만 읽는다", async () => {
    const q = assigned({ id: "promise" });
    const access = await careAccess("student");
    expect(access.readAll).toBe(false); expect(access.actor.canContribute).toBe(false);
    expect(q.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["student_id", "student"], ["owner_id", "teacher"]]);
  });
  it("배정이 없으면 학생 이름이나 약속 본문을 읽기 전에 거부한다", async () => {
    assigned(null); await expect(careAccess("student")).rejects.toThrow("권한");
  });
  it("전체 열람 역할에도 기존 학생 범위를 적용하고 조회 실패 시 중단한다", async () => {
    m.access.mockResolvedValue(true); m.visible.mockRejectedValue(new Error("조회 실패"));
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
