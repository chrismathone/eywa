import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WithdrawalReport } from "../model";

const state = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: state.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from }) }));
import { loadReportPrefill } from "./prefill";
const report = { tenant_id: "tenant", student_id: "student", group_id: "group", teacher_id: "teacher", subjects: ["math"], effective_date: "2026-10-22", snapshot: { courses: [
  { classId: "own-class", teacherId: "teacher", subject: "math", startDate: "2026-10-01" },
  { classId: "other-class", teacherId: "other", subject: "math", startDate: "2026-10-01" },
] } } as WithdrawalReport;
function query(error: { message: string } | null = null) {
  const q = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), gte: vi.fn(), lte: vi.fn(), order: vi.fn(), range: vi.fn() };
  for (const fn of Object.values(q)) fn.mockReturnValue(q);
  q.range.mockResolvedValue({ data: [], error });
  return q;
}
beforeEach(() => { state.access.mockReset().mockResolvedValue(true); state.from.mockReset(); });
describe("report prefill reads", () => {
  it("returns only the authorized report billing summary when the attendance menu is unavailable", async () => {
    state.access.mockResolvedValue(false);
    state.from.mockReturnValue(query());
    expect((await loadReportPrefill(report, "teacher")).prefill).toMatchObject({ arrears: "unknown" });
    expect(state.from).toHaveBeenCalledWith("invoices");
    expect(state.from).not.toHaveBeenCalledWith("attendance_records");
  });
  it("scopes both sources to the report tenant/student and attendance to the assigned classes", async () => {
    const attendance = query(), invoices = query();
    state.from.mockImplementation(table => table === "invoices" ? invoices : attendance);
    const result = await loadReportPrefill(report, "teacher");
    for (const q of [attendance, invoices]) {
      expect(q.eq).toHaveBeenCalledWith("tenant_id", "tenant");
      expect(q.eq).toHaveBeenCalledWith("student_id", "student");
      expect(q.range).toHaveBeenCalledWith(0, 999);
    }
    expect(attendance.gte).toHaveBeenCalledWith("session_date", "2026-10-01");
    expect(attendance.in).toHaveBeenCalledWith("class_id", ["own-class"]);
    expect(attendance.select).toHaveBeenCalledWith(expect.stringContaining("slot_start"));
    expect(result.prefill.arrears).toBe("unknown");
  });
  it("keeps the form available with a warning on source failure, without inventing a zero balance", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    state.from.mockReturnValue(query({ message: "unavailable" }));
    const result = await loadReportPrefill(report, "teacher");
    expect(result.prefill).toEqual({});
    expect(result.prefillWarning).toContain("수납 정보를 자동으로 불러오지 못했습니다");
    log.mockRestore();
  });
  it("excludes an unselected class taught by the same teacher from attendance and period", async () => {
    const attendance = query();
    state.from.mockImplementation(table => table === "invoices" ? query() : attendance);
    const selected = { ...report.snapshot.courses[0], id: "selected" };
    await loadReportPrefill({ ...report, enrollment_ids: ["selected"], snapshot: { ...report.snapshot, courses: [selected, { ...selected, id: "other", classId: "other-class", startDate: "2020-01-01" }] } }, "teacher");
    expect(attendance.in).toHaveBeenCalledWith("class_id", ["own-class"]);
    expect(attendance.gte).toHaveBeenCalledWith("session_date", "2026-10-01");
  });
});
