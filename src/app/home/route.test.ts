import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCurrentSuperAdmin } from "@/lib/auth/super-admin";
import { landingPath } from "@/lib/auth/teacher-home";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { GET } from "./route";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/auth/super-admin", () => ({ getCurrentSuperAdmin: vi.fn() }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getUserPermMatrix: vi.fn() }));
vi.mock("@/lib/auth/teacher-home", () => ({ landingPath: vi.fn() }));
vi.mock("@/features/audit/server/login-log", () => ({ pickClientIp: vi.fn(), recordLoginEvent: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/features/shuttle/parent/server/parent-viewer", () => ({ getParentViewer: vi.fn().mockResolvedValue(null) }));

const request = { nextUrl: new URL("https://aywa.example/home"), headers: new Headers() } as NextRequest;

describe("/home login landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue(null);
    vi.mocked(getParentViewer).mockResolvedValue(null);
  });

  it("sends the dedicated admin account to /admin without a tenant user row", async () => {
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue({ id: "sa", email: "admin7099@login.aywa.co.kr", displayName: "SA" });
    await expect(GET(request)).rejects.toThrow("redirect:/admin");
  });

  it("keeps another pure super admin on the existing super-admin route", async () => {
    vi.mocked(getCurrentSuperAdmin).mockResolvedValue({ id: "sa", email: "another@example.com", displayName: "SA" });
    await expect(GET(request)).rejects.toThrow("redirect:/super-admin");
  });

  it("keeps a branch super admin on the academy landing path", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "branch", tenantId: "cs", email: "st2000423@gmail.com", displayName: "Branch", jobTitle: null, systemRole: "master" });
    vi.mocked(landingPath).mockResolvedValue("/dashboard");
    await expect(GET(request)).rejects.toThrow("redirect:/dashboard");
    expect(getCurrentSuperAdmin).not.toHaveBeenCalled();
  });

  it("sends an anonymous visitor to login", async () => {
    await expect(GET(request)).rejects.toThrow("redirect:/login");
  });

  it("학부모 신원은 이용 가능 상태와 섞지 않고 /parent로 보내 안내 화면에 닿게 한다", async () => {
    vi.mocked(getParentViewer).mockResolvedValue({
      parentAccountId: "p1",
      tenantId: "t1",
      displayName: "보호자",
      children: [],
    });
    await expect(GET(request)).rejects.toThrow("redirect:/parent");
  });
});
