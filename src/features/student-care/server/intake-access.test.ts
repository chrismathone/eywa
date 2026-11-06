import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), enrollment: vi.fn(), from: vi.fn() }));
vi.mock("./access", () => ({ careAccess: m.access, careStorageMessage: () => "저장 기능 준비 중" }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: m.enrollment }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.from }) }));
import { intakeCareAccess } from "./intake-access";
function query(data: unknown) {
  const q = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error: null })) };
  q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.limit.mockReturnValue(q); return q;
}
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({ user: { id: "teacher", tenantId: "tenant", systemRole: "teacher" }, readAll: false, actor: { id: "teacher", canManage: false, canContribute: true } });
  m.enrollment.mockResolvedValue(false);
});
it("상담 메뉴 권한 없는 강사는 배정 확인 전 잠재 학생 이름도 읽지 않는다", async () => {
  const q = query(null); m.from.mockReturnValue(q);
  await expect(intakeCareAccess("intake")).rejects.toThrow("권한");
  expect(m.from).toHaveBeenCalledTimes(1);
  expect(q.eq.mock.calls).toEqual([["tenant_id", "tenant"], ["intake_id", "intake"], ["owner_id", "teacher"]]);
});
it("배정된 강사에게는 최소 대상 정보만 읽고 상담 원문과 관리자 기능을 주지 않는다", async () => {
  const source = query({ id: "intake", prospect_name: "상담 학생", student_id: null });
  m.from.mockImplementation((table) => table === "student_care_commitments" ? query({ id: "promise" }) : source);
  const access = await intakeCareAccess("intake");
  expect(access.readSource).toBe(false); expect(access.actor.canManage).toBe(false);
  expect(source.select).toHaveBeenCalledWith("id,prospect_name,student_id");
});
it("학생 등록 뒤 상담 주소로 열어도 학생 담당 범위를 다시 확인한다", async () => {
  m.from.mockImplementation((table) => query(table === "student_care_commitments" ? { id: "promise" } : { id: "intake", prospect_name: "학생", student_id: "student" }));
  m.access.mockImplementation(async (id) => { if (id) throw new Error("학생 범위 밖"); return { user: { id: "teacher", tenantId: "tenant" }, readAll: false, actor: { id: "teacher" } }; });
  await expect(intakeCareAccess("intake")).rejects.toThrow("학생 범위 밖");
});
