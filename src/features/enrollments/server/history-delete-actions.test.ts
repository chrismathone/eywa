import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "tenant", systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const enrollment = { id: "enrollment", tenant_id: "tenant", student_id: "student", class_id: "class", start_date: "2099-01-01", end_date: null,
  on_hold: false, withdrawal_reason: null, attendance_days: [], is_transferred: false, is_transferred_in: false, salary_tier: null, created_at: "2026-01-01" };
function query(admin = false) {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "neq", "or", "order", "range", "limit"]) q[key] = () => q;
  q.maybeSingle = async () => ({ data: enrollment, error: null });
  q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [], count: admin ? 0 : null, error: null }).then(done);
  return q;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => query(), rpc: m.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query(true) }) }));
import { deleteEnrollment } from "./actions";
beforeEach(() => { vi.clearAllMocks(); m.rpc.mockResolvedValue({ data: ["enrollment"], error: null }); });
it("actual deletion delegates snapshot comparison and single transactional audit to RPC", async () => {
  const fd = new FormData(); fd.set("enrollmentId", "enrollment");
  expect((await deleteEnrollment(undefined, fd))?.ok).toBe(true);
  expect(m.rpc).toHaveBeenCalledWith("delete_enrollment_history", expect.objectContaining({ p_id: "enrollment", p_expected: expect.objectContaining({ student_id: "student", class_id: "class" }) }));
  expect(m.audit).not.toHaveBeenCalled();
});
