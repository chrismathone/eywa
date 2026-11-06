import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), access: vi.fn(), enrollment: vi.fn(), visible: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.enrollment }));
vi.mock("./access", () => ({ careAccess: m.access, careStudent: async () => ({ id: "student", name: "학생", enrolledOn: null }), careStorageMessage: () => "기능 준비 중" }));
vi.mock("./student-scope", () => ({ visibleCareStudents: m.visible }));
vi.mock("./records", () => ({ careReferences: async () => ({ sources: [], evidence: [], evidenceKinds: [], warning: null }) }));
import { getOpenCare, getStudentCare } from "./queries";
const student = "00000000-0000-4000-8000-000000000001";
function query(result: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), order: vi.fn(), range: vi.fn(), returns: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) };
  for (const key of ["select", "eq", "is", "in", "order", "range", "returns"] as const) q[key].mockReturnValue(q);
  return q;
}
beforeEach(() => { vi.clearAllMocks(); m.access.mockResolvedValue({ user: { id: "user", tenantId: "tenant", systemRole: "teacher" }, readAll: false, actor: { id: "user", canManage: false, canContribute: true } }); m.enrollment.mockResolvedValue(false); });
it("확장 열이 없는 기존 DB에서도 학생 약속을 기존 열로 다시 조회한다", async () => {
  const old = query({ data: null, error: { code: "42703" } }), fallback = query({ data: [], error: null });
  m.from.mockReturnValueOnce(old).mockReturnValueOnce(fallback);
  const result = await getStudentCare(student);
  expect(result.error).toBeNull(); expect(result.records).toEqual([]);
  expect(old.select.mock.calls[0][0]).toContain("intake_id");
  expect(fallback.select.mock.calls[0][0]).not.toContain("intake_id");
  expect(fallback.eq).toHaveBeenCalledWith("owner_id", "user");
});
it("목록 조회 장애는 빈 정상 목록으로 위장하지 않으며 스키마 오류 외에는 재시도하지 않는다", async () => {
  m.from.mockReturnValue(query({ data: null, error: { code: "XX000" } }));
  const result = await getOpenCare();
  expect(result.error).toBe("기능 준비 중"); expect(m.from).toHaveBeenCalledTimes(1);
});
