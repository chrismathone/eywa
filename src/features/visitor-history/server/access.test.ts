import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), matrix: vi.fn(), settings: vi.fn(), level: vi.fn(), view: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getUserPermMatrix: m.matrix }));
vi.mock("@/lib/permissions", () => ({ accessLevel: m.level }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.view }));
import { visitorAccess } from "./access";
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ tenantId: "academy", systemRole: "admin" });
  m.matrix.mockResolvedValue({}); m.settings.mockResolvedValue({ modules: { disabled: [] } });
  m.level.mockReturnValue("full"); m.view.mockResolvedValue(null);
});
it("blocks anonymous access", async () => { m.user.mockResolvedValue(null); expect(await visitorAccess()).toBeNull(); });
it.each(["none", "scoped"])("blocks %s scope", async level => { m.level.mockReturnValue(level); expect(await visitorAccess()).toBeNull(); });
it.each(["full", "readonly"])("allows %s whole-academy access", async level => { m.level.mockReturnValue(level); expect(await visitorAccess()).toHaveProperty("tenantId", "academy"); });
it("blocks teacher projections even when the projected matrix says readonly", async () => {
  m.view.mockResolvedValue({ access: "readonly" }); m.level.mockReturnValue("readonly");
  expect(await visitorAccess()).toBeNull();
});
it("honors disabled calendar module", async () => {
  m.settings.mockResolvedValue({ modules: { disabled: ["calendar"] } }); expect(await visitorAccess()).toBeNull();
});
