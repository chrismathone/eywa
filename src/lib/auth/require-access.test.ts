import { beforeEach, expect, it, vi } from "vitest";
import { resolveMatrix } from "@/lib/permissions";
const m = vi.hoisted(() => ({ pathname: "/ecs", home: "/ecs", allowed: false }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-pathname": m.pathname }) }));
vi.mock("./current-user", () => ({ getCurrentUser: async () => ({ id: "actor", systemRole: "admin", tenantId: "branch" }) }));
vi.mock("./perm-matrix", () => ({ getUserPermMatrix: async () => resolveMatrix([{ menu: "ecs", role: "admin", access: m.allowed ? "full" : "none" }]) }));
vi.mock("./teacher-home", () => ({ landingPath: async () => m.home }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: [] } }) }));
vi.mock("@/lib/laboratory/server", () => ({ isLaboratoryMenuAvailable: async () => true }));
import { requireAccess } from "./require-access";

beforeEach(() => { m.pathname = "/ecs"; m.home = "/ecs"; m.allowed = false; });
it("exits the teacher view when its home denies access instead of redirecting forever", async () => {
  await expect(requireAccess("ecs")).rejects.toThrow("redirect:/view-reset");
});
it("still uses a different accessible home for an ordinary denial", async () => {
  m.home = "/onescreen";
  await expect(requireAccess("ecs")).rejects.toThrow("redirect:/onescreen");
});
it("does not reset an allowed home", async () => {
  m.allowed = true;
  await expect(requireAccess("ecs")).resolves.toMatchObject({ id: "actor" });
});
