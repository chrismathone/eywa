import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), enabled: vi.fn(), student: vi.fn(), binding: vi.fn(), target: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: mocks.enabled }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: mocks.student }));
vi.mock("./sync-server", () => ({ sourceBindingForTenant: mocks.binding, targetRequest: mocks.target }));
import { getStudentMathStatus } from "./student-status";
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
