import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ allowed: false, changed: true, client: vi.fn(), update: vi.fn(), audit: vi.fn(), eq: vi.fn(), is: vi.fn(),
  row: { status: "enrolled", withdrawn_at: "2099-03-01", withdrawal_metadata: { reason: "schedule" }, name: "Synthetic", notes: null } }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "actor", tenantId: "tenant", systemRole: "admin" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canManageTenant: async () => true, canWriteTenant: async () => true, accessLevelTenant: async () => "full" }));
vi.mock("./status-access", () => ({ canManageStudentStatusNow: async () => m.allowed }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { schoolSaveAliases: [] } }) }));
vi.mock("@/lib/license/server", () => ({ seatBlockReason: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.client }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { createStudent, updateStudent, changeStudentStatus, cancelScheduledWithdrawal, endStudentEnrollments,
  setStudentEnrollmentHolds, holdSingleEnrollment, endSingleEnrollment } from "./actions";
import { reactivateStudent } from "@/features/withdrawals/server/actions";

function form(status?: string, date?: string) {
  const fd = new FormData(); fd.set("id", "student"); fd.set("studentId", "student"); fd.set("enrollmentId", "enrollment");
  fd.set("name", "Synthetic"); if (status) fd.set("status", status); if (date !== undefined) fd.set("withdrawnAt", date); return fd;
}
beforeEach(() => {
  vi.clearAllMocks(); m.allowed = false; m.changed = true;
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const k of ["select", "eq", "is", "update"]) q[k] = vi.fn(() => q);
  q.eq = m.eq.mockReturnValue(q); q.is = m.is.mockReturnValue(q); q.update = m.update.mockReturnValue(q);
  q.single = vi.fn(async () => ({ data: m.row, error: null }));
  q.maybeSingle = vi.fn(async () => ({ data: m.changed ? { id: "student" } : null, error: null }));
  m.client.mockResolvedValue({ from: vi.fn(() => q) });
});
describe("actual student actions reject status changes before side effects", () => {
  it.each([changeStudentStatus, cancelScheduledWithdrawal, endStudentEnrollments, setStudentEnrollmentHolds,
    holdSingleEnrollment, endSingleEnrollment, reactivateStudent])("direct status action rejects before creating DB client", async (action) => {
    expect((await action(undefined, form()))?.error).toContain("상태 변경 권한");
    expect(m.client).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([["on_hold", ""], ["withdrawn", "2026-01-01"], ["enrolled", "2099-03-01"]])("initial status %s cannot bypass via create", async (status, date) => {
    expect((await createStudent(undefined, form(status, date)))?.error).toContain("상태 변경 권한");
    expect(m.client).not.toHaveBeenCalled();
  });
  it("basic edit omits protected columns and preserves the existing withdrawal schedule", async () => {
    expect((await updateStudent(undefined, form()))?.ok).toBe(true);
    const patch = m.update.mock.calls[0][0];
    expect(patch).not.toHaveProperty("status"); expect(patch).not.toHaveProperty("withdrawn_at"); expect(patch).not.toHaveProperty("withdrawal_metadata");
    expect(m.eq).toHaveBeenCalledWith("status", "enrolled"); expect(m.eq).toHaveBeenCalledWith("withdrawn_at", "2099-03-01");
  });
  it("old forms may resubmit unchanged status, but cannot cancel or change a schedule", async () => {
    expect((await updateStudent(undefined, form("enrolled", "2099-03-01")))?.ok).toBe(true);
    m.update.mockClear(); m.audit.mockClear();
    expect((await updateStudent(undefined, form("enrolled", "")))?.error).toContain("상태 변경 권한");
    expect((await updateStudent(undefined, form("on_hold", "2099-03-01")))?.error).toContain("상태 변경 권한");
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("concurrent status changes are not reported as successful profile saves", async () => {
    m.changed = false; expect((await updateStudent(undefined, form()))?.error).toContain("새로고침");
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([false, true])("overdue schedules permit basic edits without lifecycle side effects (old form=%s)", async (oldForm) => {
    const prior = m.row.withdrawn_at; m.row.withdrawn_at = "2020-01-01";
    try {
      expect((await updateStudent(undefined, oldForm ? form("enrolled", "2020-01-01") : form()))?.ok).toBe(true);
      const patch = m.update.mock.calls[0][0];
      expect(patch).not.toHaveProperty("status"); expect(patch).not.toHaveProperty("withdrawn_at"); expect(patch).not.toHaveProperty("withdrawal_metadata");
      expect(m.eq).toHaveBeenCalledWith("status", "enrolled"); expect(m.eq).toHaveBeenCalledWith("withdrawn_at", "2020-01-01");
      expect(m.update).toHaveBeenCalledTimes(1);
      const metadata = m.audit.mock.calls[0][0].metadata;
      expect(metadata).not.toHaveProperty("scheduledWithdrawal"); expect(metadata).not.toHaveProperty("cancelledWithdrawal");
    } finally { m.row.withdrawn_at = prior; }
  });
  it("authorized single-end writes the actual enrollment and records its actual student", async () => {
    m.allowed = true;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq"]) q[key] = vi.fn(() => q);
    q.update = m.update.mockReturnValue(q);
    q.maybeSingle = vi.fn(async () => ({ data: { start_date: "2026-01-01", student_id: "student", class_id: "class" }, error: null }));
    q.then = (done: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(done);
    m.client.mockResolvedValue({ from: vi.fn(() => q) });
    const fd = form(); fd.set("date", "2026-10-15");
    expect(await endSingleEnrollment(undefined, fd)).toBeUndefined();
    expect(m.update).toHaveBeenCalledWith({ end_date: "2026-10-15", withdrawal_reason: "other" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "enrollment_end", metadata: expect.objectContaining({ studentId: "student", classId: "class" }) }));
  });
  it("authorized single-end rejects a forged student id before writes or audit", async () => {
    m.allowed = true;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq"]) q[key] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: { start_date: "2026-01-01", student_id: "actual-student", class_id: "class" }, error: null }));
    m.client.mockResolvedValue({ from: vi.fn(() => q) });
    expect((await endSingleEnrollment(undefined, form()))?.error).toBeTruthy();
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});
