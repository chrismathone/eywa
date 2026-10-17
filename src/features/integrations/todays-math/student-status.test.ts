import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), enabled: vi.fn(), student: vi.fn(), binding: vi.fn(), target: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: mocks.enabled }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: mocks.student }));
vi.mock("./sync-server", () => ({ sourceBindingForTenant: mocks.binding, targetRequest: mocks.target }));
import { getStudentMathStatus, recentTestKindLabel } from "./student-status";
const studentId = "00000000-0000-4000-8000-000000000001";
const bindingId = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ tenantId: "tenant" }); mocks.enabled.mockResolvedValue(true);
  mocks.student.mockResolvedValue({ id: studentId }); mocks.binding.mockReturnValue({ bindingId });
  mocks.target.mockResolvedValue({ bindingId, sourceStudentId: studentId, linked: true, mode: "active", classes: [], tests: { assigned: 5, completed: 2 }, lastActivityAt: null });
});
describe("student detail Today Math status", () => {
  it("never requests another student's data without the existing scope check", async () => {
    mocks.student.mockResolvedValue(null);
    expect(await getStudentMathStatus(studentId)).toEqual({ status: "hidden" });
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it("turning the feature off prevents both display and remote data requests", async () => {
    mocks.enabled.mockResolvedValue(false);
    expect(await getStudentMathStatus(studentId)).toEqual({ status: "hidden" });
    expect(mocks.target).not.toHaveBeenCalled();
  });
  it("uses fixed binding and source student ID, with no email/name lookup", async () => {
    expect((await getStudentMathStatus(studentId)).status).toBe("ready");
    expect(mocks.target).toHaveBeenCalledWith({ bindingId }, `/api/integrations/eywa/v2/students/${studentId}?bindingId=${bindingId}`, "GET");
  });
  it("does not turn mismatched IDs or outages into an empty academic record", async () => {
    mocks.target.mockResolvedValue({ bindingId, sourceStudentId: bindingId, linked: false, mode: "active", classes: [], tests: { assigned: 0, completed: 0 }, lastActivityAt: null });
    expect(await getStudentMathStatus(studentId)).toEqual({ status: "unavailable" });
    mocks.target.mockRejectedValue(new Error("offline"));
    expect(await getStudentMathStatus(studentId)).toEqual({ status: "unavailable" });
  });
});
describe("recent tests from Today Math (read-only, 2026-10-17)", () => {
  const testId = "00000000-0000-4000-8000-000000000003";
  const base = { testId, kind: "monthly", title: "10월 월말평가", unitName: null, testDate: "2026-10-15", sourceClassId: null, className: "중2A", questionCount: 20 };
  it("an older Today Math deploy without the field still loads, and the list stays unknown (not an empty list)", async () => {
    const result = await getStudentMathStatus(studentId);
    expect(result.status).toBe("ready");
    expect(result.status === "ready" && result.data.recentTests).toBeUndefined();
  });
  it("keeps absent and not-yet-graded apart from a zero score", async () => {
    mocks.target.mockResolvedValue({ bindingId, sourceStudentId: studentId, linked: true, mode: "active", classes: [], tests: { assigned: 3, completed: 1 }, lastActivityAt: null, recentTests: [
      { ...base, result: null },
      { ...base, testId: bindingId, result: { absent: true, takenAt: "2026-10-15T01:00:00.000Z" } },
      { ...base, testId: studentId, result: { absent: false, score: 0, correctCount: 0, takenAt: "2026-10-15T01:00:00.000Z" } },
    ] });
    const result = await getStudentMathStatus(studentId);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.recentTests?.map((t) => t.result)).toEqual([null, { absent: true, takenAt: "2026-10-15T01:00:00.000Z" }, { absent: false, score: 0, correctCount: 0, takenAt: "2026-10-15T01:00:00.000Z" }]);
  });
  it("absent results cannot carry a score", async () => {
    mocks.target.mockResolvedValue({ bindingId, sourceStudentId: studentId, linked: true, mode: "active", classes: [], tests: { assigned: 1, completed: 0 }, lastActivityAt: null,
      recentTests: [{ ...base, result: { absent: true, score: 0, correctCount: 0, takenAt: "2026-10-15T01:00:00.000Z" } }] });
    const result = await getStudentMathStatus(studentId);
    expect(result.status === "ready" && result.data.recentTests?.[0]?.result).toEqual({ absent: true, takenAt: "2026-10-15T01:00:00.000Z" });
  });
  it("labels known kinds in Korean and never shows an unknown raw code", () => {
    expect(recentTestKindLabel("daily")).toBe("일일테스트");
    expect(recentTestKindLabel("monthly")).toBe("월말평가");
    expect(recentTestKindLabel("weekly_quiz")).toBe("시험");
  });
});
