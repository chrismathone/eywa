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
const gate = vi.hoisted(() => ({ lastCourse: vi.fn(async (): Promise<string | null> => null) }));
vi.mock("@/features/withdrawals/server/via-report", () => ({ lastCourseViaReport: gate.lastCourse }));
import { SCHEDULE_VIA_REPORT, WITHDRAWAL_VIA_REPORT } from "@/features/withdrawals/via-report";
import { createStudent, updateStudent, changeStudentStatus, cancelScheduledWithdrawal, endStudentEnrollments,
  setStudentEnrollmentHolds, holdSingleEnrollment, endSingleEnrollment } from "./actions";
import { reactivateStudent } from "@/features/withdrawals/server/actions";
import { endEnrollmentById } from "./enrollment-sync";

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
    // 사유는 고른다(원장 2026-10-15 *"기타는 모든 곳을 일치하게"*) — 세부·메모도 그 수강 줄에.
    const fd = form(); fd.set("date", "2026-10-15"); fd.set("reason", "other"); fd.set("memo", "개인 사정");
    expect(await endSingleEnrollment(undefined, fd)).toBeUndefined();
    expect(m.update).toHaveBeenCalledWith({ end_date: "2026-10-15", withdrawal_reason: "other", withdrawal_detail: null, withdrawal_memo: "개인 사정" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "enrollment_end", metadata: expect.objectContaining({ studentId: "student", classId: "class" }) }));
  });
  it("authorized single-end rejects a forged student id before writes or audit", async () => {
    m.allowed = true;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq"]) q[key] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: { start_date: "2026-01-01", student_id: "actual-student", class_id: "class" }, error: null }));
    m.client.mockResolvedValue({ from: vi.fn(() => q) });
    const fd = form(); fd.set("reason", "graduated");
    expect((await endSingleEnrollment(undefined, fd))?.error).toBe("수강 기록을 찾을 수 없습니다");
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("single-end without a reason (or '기타' without a memo) is rejected before reads or writes", async () => {
    m.allowed = true;
    expect((await endSingleEnrollment(undefined, form()))?.error).toBe("종료 사유를 골라 주세요.");
    const fd = form(); fd.set("reason", "other"); fd.set("memo", "  ");
    expect((await endSingleEnrollment(undefined, fd))?.error).toBeTruthy();
    expect(m.client).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("merged reason detail argument and expected student binding coexist", async () => {
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq"]) q[key] = vi.fn(() => q);
    q.update = m.update.mockReturnValue(q);
    q.maybeSingle = vi.fn(async () => ({ data: { start_date: "2026-01-01", student_id: "student", class_id: "class" }, error: null }));
    q.then = (done: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(done);
    expect((await endEnrollmentById({ from: () => q } as never, "enrollment", "2026-10-15", "grades", { detail: "detail", memo: "memo" }, "student")).error).toBeNull();
    expect(m.update).toHaveBeenCalledWith({ end_date: "2026-10-15", withdrawal_reason: "grades", withdrawal_detail: "detail", withdrawal_memo: "memo" });
  });
});

/** 원장 2026-10-23 *"퇴원 보고서를 써야 퇴원처리가 가능하도록"* — 상태 변경 담당자도 직접 퇴원·새 예약·마지막 반 종료를 못 한다. */
describe("퇴원은 퇴원보고서로만 — 서버가 거절한다(#77)", () => {
  beforeEach(() => { m.allowed = true; gate.lastCourse.mockReset(); gate.lastCourse.mockResolvedValue(null); });
  it("상태 전환 창의 퇴원(오늘·미래)은 DB를 건드리기 전에 거절", async () => {
    for (const date of ["2026-10-01", "2099-01-01"]) {
      const fd = form(); fd.set("target", "withdrawn"); fd.set("reason", "relocation"); fd.set("date", date);
      expect((await changeStudentStatus(undefined, fd))?.error).toBe(WITHDRAWAL_VIA_REPORT);
    }
    expect(m.client).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("학생 수정 폼 — 퇴원으로 바꾸기 · 예약 날짜 바꾸기는 거절, 걸린 예약 그대로 · 예약 취소는 저장", async () => {
    expect((await updateStudent(undefined, form("withdrawn", "2026-01-01")))?.error).toBe(WITHDRAWAL_VIA_REPORT);
    expect((await updateStudent(undefined, form("enrolled", "2099-04-01")))?.error).toBe(SCHEDULE_VIA_REPORT);
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
    expect((await updateStudent(undefined, form("enrolled", "2099-03-01")))?.ok).toBe(true);
    expect(m.update.mock.calls.at(-1)?.[0]).toMatchObject({ status: "enrolled", withdrawn_at: "2099-03-01" });
    expect((await updateStudent(undefined, form("enrolled", "")))?.ok).toBe(true);
    expect(m.update.mock.calls.at(-1)?.[0]).toMatchObject({ status: "enrolled", withdrawn_at: null, withdrawal_metadata: null });
    expect(m.audit.mock.calls.at(-1)?.[0].metadata).toMatchObject({ cancelledWithdrawal: "2099-03-01" });
  });
  it("새 원생에 퇴원 예약은 거절(지난 퇴원 기록 등록은 사유를 받고 통과)", async () => {
    expect((await createStudent(undefined, form("enrolled", "2099-05-01")))?.fieldErrors?.withdrawnAt).toBe(SCHEDULE_VIA_REPORT);
    expect(m.client).not.toHaveBeenCalled();
  });
  it("마지막 반 수강 종료는 게이트 문구 그대로 거절 — 쓰기·감사로그 전에", async () => {
    gate.lastCourse.mockResolvedValue("마지막 반");
    const fd = form(); fd.set("reason", "graduated");
    expect((await endSingleEnrollment(undefined, fd))?.error).toBe("마지막 반");
    expect(gate.lastCourse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ studentId: "student", enrollmentIds: ["enrollment"] }));
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});
