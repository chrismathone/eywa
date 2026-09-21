import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), scope: vi.fn(), from: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: mocks.access }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: mocks.scope }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
import { canShowAttendanceActualAmount } from "./actual-amount-access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ id: "self", tenantId: "tenant", systemRole: "teacher" });
  mocks.scope.mockResolvedValue("self");
  const builder = { select: vi.fn().mockReturnThis(), eq: mocks.eq, maybeSingle: mocks.maybeSingle };
  mocks.eq.mockReturnValue(builder);
  mocks.from.mockReturnValue(builder);
  mocks.maybeSingle.mockResolvedValue({ data: { employment_type: "프리랜서" }, error: null });
});

describe("actual lesson amount visibility", () => {
  it("allows a freelancer's own view and scopes the lookup to the authenticated tenant", async () => {
    expect(await canShowAttendanceActualAmount("self")).toBe(true);
    expect(mocks.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(mocks.eq).toHaveBeenCalledWith("id", "self");
  });
  it.each(["정규직", "아르바이트", null, ""])("hides the amount for contract type %s", async (employment_type) => {
    mocks.maybeSingle.mockResolvedValue({ data: { employment_type }, error: null });
    expect(await canShowAttendanceActualAmount("self")).toBe(false);
  });
  it("rejects another teacher's id before reading staff information", async () => {
    expect(await canShowAttendanceActualAmount("other")).toBe(false);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("lets the office inspect the selected freelance view, but not an unscoped whole-school view", async () => {
    mocks.access.mockResolvedValue({ id: "office", tenantId: "tenant", systemRole: "master" });
    mocks.scope.mockResolvedValue(null);
    expect(await canShowAttendanceActualAmount("self")).toBe(true);
    expect(await canShowAttendanceActualAmount(null)).toBe(false);
  });
  it("fails closed if the employment lookup fails", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await canShowAttendanceActualAmount("self")).toBe(false);
  });
});
